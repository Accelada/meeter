// Must run against the explicitly selected disposable branch, never production.
import assert from 'node:assert/strict';
import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {pool} from '../server/database.mjs';
import {tenantTransaction,createCompany} from '../server/company-store.mjs';
import {handleSend} from '../src/on-send.js';
if(process.env.MEETER_TEST_BRANCH!=='meeter-multitenant-test' || !process.env.DATABASE_URL?.includes('ep-frosty-truth-bdtav67h'))throw new Error('Selecciona la rama temporal explícitamente.');
const origin='https://tenant-test.example.com',key=randomBytes(32).toString('hex'),port=3198;
const suffix=randomBytes(5).toString('hex');let child;const created=[];
function deviceToken(){return 'mt_'+randomBytes(32).toString('base64url');}
async function session(company,email,role='employee'){
 await pool.query('INSERT INTO meeter.members(company_id,email,role) VALUES($1,$2,$3)',[company.id,email,role]);
 const token=deviceToken();await pool.query('INSERT INTO meeter.device_sessions(token_hash,company_id,email) VALUES($1,$2,$3)',[createHash('sha256').update(token).digest('hex'),company.id,email]);return token;
}
async function call(path,token,method='GET',body){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:'tenant-test.example.com',Origin:origin,...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})}},res=>{let text='';res.on('data',b=>{text+=b;});res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(text)});}catch{reject(new Error(`${method} ${path}: ${res.statusCode} ${text}`));}});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
try{
 const a=await createCompany({slug:`test-a-${suffix}`,name:'Test A'});created.push(a.id);
 const b=await createCompany({slug:`test-b-${suffix}`,name:'Test B'});created.push(b.id);
 const admin=await session(a,'admin@a.invalid','admin'),alice=await session(a,'alice@a.invalid'),bob=await session(a,'bob@a.invalid'),other=await session(b,'other@b.invalid');
 const company={...a,email:'admin@a.invalid',role:'admin'};
 await tenantTransaction(company,async db=>{
  assert.equal((await db.query('SELECT * FROM meeting_cost.rate_catalog')).rowCount,0);
  assert.equal((await db.query('SELECT * FROM meeting_cost.estimates')).rowCount,0);
  await db.query("INSERT INTO meeting_cost.cost_centers(id,name) VALUES('CC1','Centro A')");
  await db.query("INSERT INTO meeting_cost.rate_catalog(email,name,cost,currency) VALUES('alice@a.invalid','Alice',50,'EUR')");
 });
 child=spawn(process.execPath,['scripts/server.mjs'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',MEETER_MULTI_TENANT:'true',PUBLIC_BASE_URL:origin,SERVICE_API_KEY:key,TLS_TERMINATION:'proxy',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>{stderr+=b;});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout: '+stderr)),15000);child.stdout.on('data',()=>{clearTimeout(timer);resolve();});child.on('exit',()=>reject(new Error(stderr)));});
 const route=`/api/companies/${a.slug}`;
 assert.equal((await call(route)).status,401);
 assert.equal((await call(route,other)).status,401); // Token belongs to B.
 assert.equal((await call('/api/rates',key)).status,404); // No legacy production escape hatch.
 assert.equal((await call(route+'/admin/catalog',alice)).status,403);
 const rates=await call(route+'/rates',alice);assert.equal(rates.status,200);assert.equal(rates.value.employees[0].hourlyRate,50);
 const requestId=randomUUID(),payload={source:'outlook',requestId,costCenterId:'CC1',meeting:{subject:'Tenant integration',durationMinutes:30,attendees:[{email:'alice@a.invalid'}],outlookItemId:'ews-'+suffix,recurrence:{type:'weekly',interval:1,startDate:'2026-11-03',numberOfOccurrences:4}}};
 const saved=await call(route+'/estimates',alice,'POST',payload);assert.equal(saved.status,201);assert.equal(saved.value.report.total,25);assert.equal(saved.value.report.seriesTotal,100);
 assert.equal((await call(route+'/estimates',alice,'POST',payload)).status,201);
 assert.equal((await call(route+`/v1/meetings?id=${requestId}&durationMinutes`,alice)).value.value,30);
 assert.equal((await call(route+`/v1/meetings?id=${requestId}`,bob)).status,404);
 const attack=await call(route+'/estimates',bob,'POST',{...payload,meeting:{...payload.meeting,subject:'overwrite attempt'}});assert.notEqual(attack.status,201);
 assert.equal((await call(route+`/v1/meetings?id=${requestId}`,alice)).value.subject,'Tenant integration');
 assert.equal((await call(`/api/companies/${b.slug}/v1/meetings?id=${requestId}`,other)).status,404);
 assert.equal((await call(route+'/estimates',admin)).value.length,1);
 console.log('PASS: companies start empty; employee cannot access administration; UUID/EWS/attributes and recurring totals work; retries preserve one meeting; another employee/company cannot read or overwrite it.');
 const properties=new Map([['meetingCostCenter','CC1']]);
 const property=value=>({getAsync:cb=>cb({status:'succeeded',value})});
 const item={itemType:'appointment',itemId:'ews-send-'+suffix,
  requiredAttendees:property([{emailAddress:'alice@a.invalid'}]),optionalAttendees:property([]),organizer:property({emailAddress:'alice@a.invalid'}),
  subject:property('Prueba handler sin envío'),start:property('2026-11-03T10:00:00Z'),end:property('2026-11-03T10:30:00Z'),
  loadCustomPropertiesAsync:cb=>cb({status:'succeeded',value:{get:k=>properties.get(k),set:(k,v)=>properties.set(k,v),saveAsync:cb=>cb({status:'succeeded'})}}),notificationMessages:{addAsync:()=>{}}};
 let completion;
 await handleSend({completed:value=>{completion=value;}},{office:{context:{mailbox:{item},roamingSettings:{get:()=>({slug:a.slug,token:alice,expiresAt:new Date(Date.now()+60000).toISOString()})}}},fetchImpl:async(path,options)=>{
  const reply=await call(path,options.headers.Authorization.slice(7),'POST',JSON.parse(options.body));return {ok:reply.status===201,json:async()=>reply.value};
 }});
 assert.deepEqual(completion,{allowEvent:true});
 const fromHandler=await call(route+`/v1/meetings?id=${properties.get('meetingCostEstimateId')}`,alice);assert.equal(fromHandler.value.total,25);
 console.log('PASS: actual ItemSend handler -> company HTTP API -> Neon -> confirmed persistence before allowEvent, without sending any invitation.');
 const badImport={kind:'employees',format:'csv',content:'email,name,cost,currency\nx@y.invalid,X,-2,EUR',mode:'replace'};
 assert.equal((await call(route+'/admin/import',admin,'POST',badImport)).value.valid,false);
 assert.equal((await call(route+'/admin/import',admin,'POST',{...badImport,apply:true})).status,400);
 assert.equal((await call(route+'/rates',alice)).value.employees.length,1);
 const goodImport={...badImport,content:'email,name,position,cost,currency\nalice@a.invalid,Alice,Engineer,80,EUR'};
 assert.equal((await call(route+'/admin/import',admin,'POST',{...goodImport,apply:true})).status,200);
 assert.equal((await call(route+'/rates',alice)).value.employees[0].hourlyRate,80);
 assert.equal((await call(route+'/admin/settings',admin,'POST',{currency:'USD',defaultHourlyRate:20,excludedEmails:[]})).status,200);
 assert.equal((await call(route+'/rates',alice)).value.currency,'USD');
 assert.equal((await call(route+'/admin/members',admin,'POST',{email:'alice@a.invalid',role:'employee',active:false})).status,200);
 assert.equal((await call(route+'/rates',alice)).status,401);
 console.log('PASS: CSV preview and atomic import; failed replacement preserves catalog; settings currency cascades; member deactivation revokes credentials.');
 // Deliberately issue broad SQL: PostgreSQL itself must filter it, independent of URL/query code.
 await tenantTransaction({...a,email:'bob@a.invalid',role:'employee'},async db=>{
  assert.equal((await db.query('SELECT * FROM meeting_cost.estimates')).rowCount,0);
  await assert.rejects(()=>db.query("INSERT INTO meeting_cost.cost_centers(company_id,id,name) VALUES($1,'EVIL','Injected')",[b.id]));
 });
 console.log('PASS: database RLS rejects cross-company writes and hides other users\' meetings.');
}finally{
 child?.kill();
 for(const id of created){for(const table of ['device_sessions','members','estimates','rate_catalog','cost_centers','excluded_emails','settings'])await pool.query(`DELETE FROM meeter.${table} WHERE company_id=$1`,[id]);await pool.query('DELETE FROM meeter.companies WHERE id=$1',[id]);}
 await pool.end();
}
