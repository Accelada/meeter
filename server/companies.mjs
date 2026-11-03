import {pool} from './database.mjs';
import {config,allowedOrigin} from './access.mjs';
import {api} from './api.mjs';
import {RequestError} from './meetings.mjs';
import {multiTenant,isOperator,verifiedIdentity,companyAccess,issueDeviceSession,revokeDeviceSession} from './company-auth.mjs';
import {tenantTransaction,createCompany} from './company-store.mjs';
import {previewImport,applyImport} from './imports.mjs';
export function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){
 let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2*1024*1024)throw new RequestError('Máximo 2 MB.',413);}
 if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new RequestError('Se requiere application/json.');
 try{return JSON.parse(text);}catch{throw new RequestError('JSON inválido.');}
}
function admin(company){if(company.role!=='admin')throw new RequestError('Solo administradores de la empresa.',403);}
export async function companies(req,res,url){
 if(!['/api/config','/api/companies','/api/session'].includes(url.pathname) && !url.pathname.startsWith('/api/companies/'))return false;
 if(!allowedOrigin(req)){json(res,403,{error:'Origen no permitido.'});return true;}
 if(url.pathname==='/api/config'){json(res,200,{multiTenant:multiTenant(),authConfigured:Boolean(process.env.NEON_AUTH_BASE_URL),microsoftEnabled:process.env.MICROSOFT_LOGIN_ENABLED==='true'});return true;}
 if(!multiTenant()){json(res,404,{error:'Multiempresa no activado.'});return true;}
 try{
  if(!pool)throw new RequestError('PostgreSQL no configurado.',503);
  if(url.pathname==='/api/session' && req.method==='DELETE'){await revokeDeviceSession(req);json(res,200,{ok:true});return true;}
  if(url.pathname==='/api/companies'){
   if(req.method==='POST'){
    if(!isOperator(req))throw new RequestError('Credenciales del administrador del servicio requeridas.',403);
    const company=await createCompany(await body(req));json(res,201,{...company,endpoint:`${config.origin}/empresas/${company.slug}`});return true;
   }
   if(req.method==='GET'){
    const rows=isOperator(req)?(await pool.query('SELECT id,slug,name FROM meeter.companies ORDER BY name')).rows:
     (await pool.query('SELECT c.id,c.slug,c.name,m.role FROM meeter.companies c JOIN meeter.members m ON m.company_id=c.id WHERE m.email=$1 AND m.active ORDER BY c.name',[(await verifiedIdentity(req)).email])).rows;
    json(res,200,rows.map(c=>({...c,endpoint:`${config.origin}/empresas/${c.slug}`})));return true;
   }
  }
  const match=url.pathname.match(/^\/api\/companies\/([a-z0-9-]+)(\/.*)?$/);
  if(!match)throw new RequestError('Ruta no encontrada.',404);
  const company=await companyAccess(req,match[1],{identityOnly:match[2]==='/session'}),path=match[2] || '';
  if(path==='' && req.method==='GET'){json(res,200,{id:company.id,name:company.name,slug:company.slug,role:company.role,email:company.email});return true;}
  if(path==='/session' && req.method==='POST'){json(res,201,await issueDeviceSession(company));return true;}
  if(path.startsWith('/admin/')){
   admin(company);
   if(path==='/admin/members' && req.method==='GET'){json(res,200,(await pool.query('SELECT email,role,active FROM meeter.members WHERE company_id=$1 ORDER BY email',[company.id])).rows);return true;}
   if(path==='/admin/members' && req.method==='POST'){
    const input=await body(req);const email=String(input.email || '').trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(email) || email.length>254 || !['admin','employee'].includes(input.role) || typeof input.active!=='boolean')throw new RequestError('Miembro inválido.');
    if(email===company.email && (input.role!=='admin' || !input.active))throw new RequestError('No puedes retirar tu propio acceso de administrador.');
    await pool.query('INSERT INTO meeter.members(company_id,email,role,active) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,email) DO UPDATE SET role=excluded.role,active=excluded.active',[company.id,email,input.role,input.active]);
    // Revocation also invalidates dormant device credentials. Re-enabling requires login.
    if(!input.active)await pool.query('DELETE FROM meeter.device_sessions WHERE company_id=$1 AND email=$2',[company.id,email]);
    json(res,200,{ok:true});return true;
   }
   if(path==='/admin/catalog' && req.method==='GET'){
    const result=await tenantTransaction(company,async db=>({settings:(await db.query('SELECT currency,default_hourly_cost::float8 AS "defaultHourlyRate" FROM meeting_cost.settings WHERE id=1')).rows[0],employees:(await db.query('SELECT email,name,position,cost::float8 AS cost,currency,active FROM meeting_cost.rate_catalog ORDER BY email')).rows,centers:(await db.query('SELECT id,name FROM meeting_cost.cost_centers ORDER BY id')).rows,excludedEmails:(await db.query('SELECT email FROM meeting_cost.excluded_emails ORDER BY email')).rows.map(r=>r.email)}));
    json(res,200,result);return true;
   }
   if(path==='/admin/settings' && req.method==='POST'){
    const input=await body(req);
    if(!/^[A-Z]{3}$/.test(input.currency) || !Number.isFinite(input.defaultHourlyRate) || input.defaultHourlyRate<0 || !Array.isArray(input.excludedEmails) || input.excludedEmails.length>5000 || input.excludedEmails.some(e=>typeof e!=='string' || !/^\S+@\S+\.\S+$/.test(e) || e.length>254))throw new RequestError('Configuración inválida.');
    await tenantTransaction(company,async db=>{
     await db.query('UPDATE meeting_cost.settings SET currency=$1,default_hourly_cost=$2 WHERE id=1',[input.currency,input.defaultHourlyRate]);
     await db.query('DELETE FROM meeting_cost.excluded_emails');
     for(const email of new Set(input.excludedEmails.map(e=>e.trim().toLowerCase())))await db.query('INSERT INTO meeting_cost.excluded_emails(email) VALUES($1)',[email]);
    });json(res,200,{ok:true});return true;
   }
   if(path==='/admin/import' && req.method==='POST'){
    const input=await body(req),preview=previewImport(input);
    if(input.apply){if(!preview.valid)throw new RequestError(preview.errors.join('\n'));json(res,200,await tenantTransaction(company,db=>applyImport(db,preview,input.mode)));}
    else json(res,200,preview);return true;
   }
   if(path==='/admin/employee' && req.method==='DELETE'){
    const input=await body(req);await tenantTransaction(company,db=>db.query('DELETE FROM meeting_cost.rate_catalog WHERE email=$1',[String(input.email).trim().toLowerCase()]));json(res,200,{ok:true});return true;
   }
   if(path==='/admin/center' && req.method==='DELETE'){
    const input=await body(req);await tenantTransaction(company,db=>db.query('DELETE FROM meeting_cost.cost_centers WHERE id=$1',[input.id]));json(res,200,{ok:true});return true;
   }
   if(path==='/admin/sessions' && req.method==='DELETE'){
    const input=await body(req);await pool.query('DELETE FROM meeter.device_sessions WHERE company_id=$1 AND email=$2',[company.id,String(input.email).trim().toLowerCase()]);json(res,200,{ok:true});return true;
   }
   throw new RequestError('Ruta no encontrada.',404);
  }
  const apiUrl=new URL(`/api${path}`,config.origin);
  apiUrl.search=url.search;
  // Buffer the response until COMMIT succeeds, so the caller never sees a premature 201.
  const reply=await tenantTransaction(company,async db=>{
   let status,headers,content;
   const buffered={writeHead:(s,h)=>{status=s;headers=h;},end:value=>{content=value;}};
   await api(req,buffered,apiUrl,{db});return {status,headers,content};
  });res.writeHead(reply.status,reply.headers);res.end(reply.content);
 }catch(error){
  if(error instanceof RequestError)json(res,error.status,{error:error.message});
  else{console.error('Empresa:',error.code || error.name);json(res,503,{error:'No se pudo completar la operación. Comprueba las migraciones y la conexión.'});}
 }
 return true;
}
