import '../server/env.mjs';
import assert from 'node:assert/strict';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pool} from '../server/database.mjs';
import {handleSend} from '../src/on-send.js';

const origin='https://localhost:3000';
// Trust only the installed development CA; TLS verification remains enabled.
const ca=await readFile(resolve(homedir(), '.office-addin-dev-certs/ca.crt'));
function request(path, options={}) {
  return new Promise((resolve,reject)=>{
    const req=https.request(`${origin}${path}`, {ca,...options},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);
      res.on('end',()=>resolve({status:res.statusCode, text, data:()=>JSON.parse(text)}));
    });
    req.on('error',reject);req.end(options.body);
  });
}
let savedId,employeeEmail;
try {
  assert.ok(pool,'Configura DATABASE_URL antes de la prueba.');
  const page=await request('/taskpane.html?demo=1');assert.equal(page.status,200);assert.match(page.text,/<details/);assert.doesNotMatch(page.text,/id="(?:save|refresh|historySection|warning)"/);
  assert.equal((await request('/src/on-send.bundle.js')).status,200);
  console.log('PASS HTTPS taskpane: HTTP 200, certificado validado, interfaz minimalista y script de envío');
  const rates=await request('/api/rates');assert.equal(rates.status,200);const config=rates.data();
  const stored=await pool.query('SELECT email, name, cost::float8 AS cost, currency FROM meeting_cost.rate_catalog WHERE active ORDER BY employee_id');
  assert.deepEqual(config.employees.map(p=>({email:p.email,name:p.name,cost:p.hourlyRate,currency:config.currency})),stored.rows);
  console.log('PASS catálogo: API coincide con PostgreSQL');
  employeeEmail=`e2e-${randomUUID()}@example.com`;
  await pool.query('INSERT INTO meeting_cost.rate_catalog (name,email,position,cost,currency) VALUES ($1,$2,$3,$4,$5)',['Prueba SQL',employeeEmail,'Pruebas',12.5,config.currency]);
  assert.equal((await request('/api/rates')).data().employees.find(p=>p.email===employeeEmail).hourlyRate,12.5);
  await pool.query('UPDATE meeting_cost.rate_catalog SET cost=18, name=$1 WHERE email=$2',['Nombre actualizado',employeeEmail]);
  const changed=(await request('/api/rates')).data().employees.find(p=>p.email===employeeEmail);
  assert.equal(changed.hourlyRate,18);assert.equal(changed.name,'Nombre actualizado');
  await pool.query('DELETE FROM meeting_cost.rate_catalog WHERE email=$1',[employeeEmail]);employeeEmail=undefined;
  console.log('PASS catálogo SQL: alta, edición y baja de empleado reflejadas en la API');
  const input={meeting:{subject:`Prueba E2E ${randomUUID()}`,durationMinutes:30,attendees:config.employees.map(p=>({email:p.email}))},
    source:'demo',costCenterId:config.costCenters[0].id};
  const headers={'Content-Type':'application/json',Origin:origin};
  const denied=await request('/api/estimates',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:JSON.stringify(input)});
  assert.equal(denied.status,403);
  const invalid=await request('/api/estimates',{method:'POST',headers,body:JSON.stringify({...input,meeting:{...input.meeting,durationMinutes:-1}})});
  assert.equal(invalid.status,400);
  const manual=await request('/api/estimates',{method:'POST',headers,body:JSON.stringify({...input,overrides:{'junior@ejemplo.com':1}})});
  assert.equal(manual.status,400);
  console.log('PASS validación: origen ajeno 403, duración inválida 400');
  const saved=await request('/api/estimates',{method:'POST',headers,body:JSON.stringify(input)});
  assert.equal(saved.status,201);const row=saved.data();savedId=row.id;
  const persisted=await pool.query('SELECT report FROM meeting_cost.estimates WHERE id=$1',[savedId]);
  assert.deepEqual(persisted.rows[0].report,row.report);
  assert.equal(row.report.total, config.employees.reduce((sum,p)=>sum+p.hourlyRate,0)/2);
  const history=await request('/api/estimates');assert.equal(history.status,200);
  assert.ok(history.data().some(item=>item.id===savedId && item.report.subject===input.meeting.subject));
  console.log(`PASS guardado E2E: POST 201 → fila PostgreSQL → historial GET 200; total ${row.report.total} ${row.report.currency}`);
  const recurring=await request('/api/estimates',{method:'POST',headers,body:JSON.stringify({...input,requestId:savedId,meeting:{...input.meeting,recurrence:{type:'weekly',startDate:'2026-11-02',numberOfOccurrences:10}}})});
  assert.equal(recurring.status,201);assert.equal(recurring.data().report.occurrenceCount,10);assert.equal(recurring.data().report.seriesTotal,row.report.total*10);
  const seriesField=await request(`/api/v1/meetings?id=${savedId}&attribute=seriesTotal`);assert.equal(seriesField.data().value,row.report.total*10);
  const infinite=await request('/api/estimates',{method:'POST',headers,body:JSON.stringify({...input,requestId:savedId,meeting:{...input.meeting,recurrence:{type:'weekly',startDate:'2026-11-02',endDate:null}}})});
  assert.equal(infinite.status,201);assert.equal(infinite.data().report.seriesTotal,null);
  console.log('PASS serie periódica: total de 10 reuniones persistido y consultable; sin fin devuelve total null');
  await pool.query('DELETE FROM meeting_cost.estimates WHERE id=$1',[savedId]);
  savedId=randomUUID();
  const props=new Map([['meetingCostEstimateId',savedId]]);
  const property=value=>({getAsync:cb=>cb({status:'succeeded',value})});
  const outlookItemId=`EWS/id+${savedId}=`;
  const item={itemType:'appointment',itemId:outlookItemId,requiredAttendees:property(config.employees.slice(1).map(p=>({emailAddress:p.email}))),optionalAttendees:property([]),
    organizer:property({emailAddress:config.employees[0].email}),subject:property(input.meeting.subject),start:property('2026-11-02T10:00:00Z'),end:property('2026-11-02T10:30:00Z'),
    loadCustomPropertiesAsync:cb=>cb({status:'succeeded',value:{get:key=>props.get(key)}}),notificationMessages:{addAsync:()=>assert.fail('No debe fallar el guardado')}};
  const completions=[];
  const fetchImpl=async(path,options)=>{const res=await request(new URL(path,origin).pathname,{...options,headers:{...options.headers,Origin:origin}});return {ok:res.status===201,json:async()=>res.data()};};
  for(let retry=0;retry<2;retry++)await handleSend({completed:result=>completions.push(result)},{office:{context:{mailbox:{item}}},fetchImpl});
  assert.deepEqual(completions,[{allowEvent:true},{allowEvent:true}]);
  const automatic=await pool.query('SELECT report FROM meeting_cost.estimates WHERE id=$1',[savedId]);
  assert.equal(automatic.rows.length,1);assert.equal(automatic.rows[0].report.captureEvent,'ItemSend');assert.equal(automatic.rows[0].report.total,row.report.total);
  console.log('PASS ItemSend simulado → API HTTPS → Neon; reintento sin duplicados; tarifas de solo lectura');
  for(const id of [savedId,outlookItemId]){
    const field=await request(`/api/v1/meetings?id=${encodeURIComponent(id)}&durationMinutes`);
    assert.equal(field.status,200);assert.equal(field.data().value,30);
  }
  const single=await request('/api/v1/meetings/query',{method:'POST',headers,body:JSON.stringify({id:outlookItemId})});
  assert.equal(single.status,200);assert.equal(single.data().meetings[0].id,savedId);
  const batch=await request('/api/v1/meetings/query',{method:'POST',headers,body:JSON.stringify({ids:[savedId,outlookItemId,'missing-id']})});
  assert.equal(batch.status,200);assert.equal(batch.data().meetings.length,1);assert.deepEqual(batch.data().missingIds,['missing-id']);
  assert.equal((await request(`/api/v1/meetings?id=${savedId}&attribute=privateField`)).status,400);
  assert.equal((await request('/api/v1/meetings?id=missing-id')).status,404);
  console.log('PASS API de reuniones: POST por ID y lote, UUID/Outlook, atributo, 400 y 404');
  for(const path of ['/.env.local','/.env','/server/database.mjs','/neon.ts']) assert.equal((await request(path)).status,404);
  console.log('PASS secretos y código del servidor: HTTP 404');
} finally {
  if(employeeEmail)await pool.query('DELETE FROM meeting_cost.rate_catalog WHERE email=$1',[employeeEmail]);
  if(savedId) {await pool.query('DELETE FROM meeting_cost.estimates WHERE id=$1',[savedId]);console.log('Registro E2E eliminado.');}
  await pool?.end();
}
