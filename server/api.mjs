import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {databaseEnabled, pool, getRates} from './database.mjs';
import {calculate} from '../src/calculator.js';
import {recurrenceSummary} from '../src/recurrence.js';
import {allowedOrigin,requireAccess} from './access.mjs';
import {findMeetings,meetingIds,selectedAttribute,RequestError} from './meetings.mjs';

function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
class InputError extends RequestError {}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 65536) throw new InputError('Solicitud demasiado grande.');
  }
  try { return JSON.parse(text); } catch { throw new InputError('JSON inválido.'); }
}
function validate(input) {
  const {meeting, overrides = {}, source, costCenterId, requestId} = input || {};
  if (!meeting || typeof meeting.subject !== 'string' || meeting.subject.length > 500 ||
      !Array.isArray(meeting.attendees) || meeting.attendees.length > 500 ||
      !Number.isFinite(meeting.durationMinutes) || meeting.durationMinutes <= 0 || meeting.durationMinutes > 525600 ||
      !['demo', 'outlook'].includes(source) || (costCenterId !== null && typeof costCenterId !== 'string') ||
      !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new InputError('Estimación inválida.');
  for (const p of meeting.attendees) {
    if (!p || typeof p.email !== 'string' || p.email.length > 254 || !/^\S+@\S+\.\S+$/.test(p.email.trim()) ||
        (p.name !== undefined && (typeof p.name !== 'string' || p.name.length > 500)) ||
        (p.isResource !== undefined && typeof p.isResource !== 'boolean')) throw new InputError('Asistente inválido.');
  }
  if(Object.keys(overrides).length)throw new InputError('Las tarifas solo pueden establecerse en el catálogo PostgreSQL.');
  if(requestId!==undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new InputError('Identificador inválido.');
  if(source==='outlook' && !requestId)throw new InputError('Falta el identificador de la convocatoria.');
  for(const key of ['outlookItemId','organizerEmail'])if(meeting[key]!==undefined && (typeof meeting[key]!=='string' || meeting[key].length>2048))throw new InputError('Metadatos de Outlook inválidos.');
  for (const key of ['start','end']) if (meeting[key] !== undefined && (typeof meeting[key] !== 'string' || !Number.isFinite(Date.parse(meeting[key])))) throw new InputError('Fecha inválida.');
  try{recurrenceSummary(meeting.recurrence);}catch(error){throw new InputError(error.message);}
  return {meeting, source, costCenterId, requestId};
}
export async function api(req, res, url) {
  if (!url.pathname.startsWith('/api/')) return false;
  if (!allowedOrigin(req)) {
    json(res, 403, {error:'Origen no permitido.'}); return true;
  }
  if(!requireAccess(req,res))return true;
  if (!databaseEnabled) {json(res, 503, {code:'DATABASE_NOT_CONFIGURED', error:'PostgreSQL no configurado.'}); return true;}
  try {
    if(req.method==='GET' && url.pathname==='/api/openapi.json'){
      json(res,200,JSON.parse(await readFile(new URL('../docs/openapi.json',import.meta.url),'utf8')));return true;
    }
    if(req.method==='POST' && (req.headers['content-type']?.split(';')[0]!=='application/json' || (!req.headers.origin && !req.headers.authorization)))throw new InputError('Se requiere JSON y Origin o autenticación explícita.');
    if(req.method==='POST' && url.pathname==='/api/v1/meetings/query'){
      json(res,200,await findMeetings(pool,meetingIds(await body(req))));return true;
    }
    if(req.method==='GET' && url.pathname==='/api/v1/meetings'){
      const ids=meetingIds({id:url.searchParams.get('id')});
      const attribute=selectedAttribute(url);
      const found=await findMeetings(pool,ids);
      if(!found.meetings.length)throw new RequestError('Convocatoria no encontrada.',404);
      const meeting=found.meetings[0];
      json(res,200,attribute?{id:meeting.id,attribute,value:meeting[attribute] ?? null}:meeting);return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/rates') json(res, 200, await getRates());
    else if (req.method === 'GET' && url.pathname === '/api/estimates') {
      const {rows} = await pool.query('SELECT id, created_at AS "createdAt", report FROM meeting_cost.estimates ORDER BY created_at DESC, id DESC LIMIT 20');
      json(res, 200, rows);
    } else if (req.method === 'POST' && url.pathname === '/api/estimates') {
      const {meeting, source, costCenterId, requestId} = validate(await body(req));
      const config = await getRates();
      const costCenter = costCenterId===null ? config.costCenters[0] : config.costCenters.find(c => c.id === costCenterId);
      if (!costCenter) throw new InputError('Centro de coste desconocido.');
      const report = {schemaVersion:1, generatedAt:new Date().toISOString(), source, costCenter,
        captureEvent:source==='outlook'?'ItemSend':undefined,
        subject:meeting.subject, start:meeting.start, end:meeting.end, recurrence:meeting.recurrence, outlookItemId:meeting.outlookItemId, organizerEmail:meeting.organizerEmail, ...calculate(meeting, config)};
      const {rows} = await pool.query('INSERT INTO meeting_cost.estimates (id, report) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET report = EXCLUDED.report RETURNING id, created_at AS "createdAt", report', [requestId || randomUUID(), JSON.stringify(report)]);
      json(res, 201, rows[0]);
    } else json(res, 404, {error:'Ruta no encontrada.'});
  } catch (error) {
    if (error instanceof RequestError) json(res, error.status, {error:error.message});
    else {console.error('Error PostgreSQL:', error.code || error.name); json(res, 503, {error:'No se pudo acceder a PostgreSQL. Comprueba la conexión y las migraciones.'});}
  }
  return true;
}
