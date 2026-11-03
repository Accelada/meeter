import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {pool} from '../server/database.mjs';
import {createCompany} from '../server/company-store.mjs';
if(process.env.MEETER_TEST_BRANCH!=='meeter-multitenant-test' || !process.env.DATABASE_URL?.includes('ep-frosty-truth-bdtav67h'))throw new Error('Solo se admite la rama de prueba.');
const origin='https://tenant-test.example.com',port=3199,key=randomBytes(32).toString('hex'),suffix=randomBytes(5).toString('hex');
const email=`test-${suffix}@meeter.invalid`,password=randomBytes(24).toString('base64url'),cookies=new Map();let child,company,userId;
async function call(path,method='GET',body,token){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:'tenant-test.example.com',Origin:origin,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{
   for(const cookie of res.headers['set-cookie'] || []){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
   let text='';res.on('data',b=>{text+=b;});res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(text),headers:res.headers});}catch{reject(new Error(`${path}: ${res.statusCode} ${text.slice(0,200)}`));}});
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
try{
 child=spawn(process.execPath,['scripts/server.mjs'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',MEETER_MULTI_TENANT:'true',PUBLIC_BASE_URL:origin,SERVICE_API_KEY:key,TLS_TERMINATION:'proxy',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>{stderr+=b;});await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(stderr || 'Server timeout')),15000);child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});});
 const signup=await call('/auth/sign-up/email','POST',{email,password,name:'Test Meeter'});assert.equal(signup.status,200,JSON.stringify(signup.value));userId=signup.value.user?.id;assert.ok(userId);
 const restored=await call('/auth/get-session');assert.equal(restored.status,200);assert.equal(restored.value.user.email,email);
 const firstToken=await call('/auth/token');assert.ok(firstToken.value.token,JSON.stringify(firstToken.value));
 company=await createCompany({name:'Identity test',slug:`auth-${suffix}`});await pool.query("INSERT INTO meeter.members(company_id,email,role) VALUES($1,$2,'admin')",[company.id,email]);
 const route=`/api/companies/${company.slug}`;
 assert.equal((await call(route,'GET',null,firstToken.value.token)).status,401);
 // Test-only provisioning: verify the fixture in the disposable branch without sending mail.
 const columns=(await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='neon_auth'")).rows;
 const table=columns.find(c=>c.column_name==='emailVerified' && columns.some(d=>d.table_name===c.table_name && d.column_name==='email'))?.table_name;
 assert.ok(table && /^[A-Za-z_]+$/.test(table),'Neon user table not found');
 await pool.query(`UPDATE neon_auth."${table}" SET "emailVerified"=true WHERE id=$1`,[userId]);
 assert.equal((await call('/auth/sign-out','POST',{})).status,200);cookies.clear();
 const bad=await call('/auth/sign-in/email','POST',{email,password:'wrong-password'});assert.equal(bad.status,401);
 const signin=await call('/auth/sign-in/email','POST',{email,password});assert.equal(signin.status,200,JSON.stringify(signin.value));
 const jwt=(await call('/auth/token')).value.token;assert.ok(jwt);
 const companyInfo=await call(route,'GET',null,jwt);assert.equal(companyInfo.status,200,JSON.stringify(companyInfo.value));
 const session=await call(route+'/session','POST',null,jwt);assert.equal(session.status,201,JSON.stringify(session.value));assert.ok(session.value.token);
 assert.equal((await call(route,'GET',null,session.value.token)).status,200);
 assert.equal((await call('/api/session','DELETE',null,session.value.token)).status,200);
 assert.equal((await call(route,'GET',null,session.value.token)).status,401);
 await call('/auth/sign-out','POST',{});cookies.clear();const signedOut=await call('/auth/get-session');assert.equal(signedOut.value,null);
 console.log('PASS: real Neon Auth signup (mail disabled), session restoration, wrong-password rejection, sign-in, verified-email JWT validation, company membership, device session issuance/revocation, sign-out.');
}finally{
 child?.kill();
 if(company){await pool.query('DELETE FROM meeter.device_sessions WHERE company_id=$1',[company.id]);await pool.query('DELETE FROM meeter.members WHERE company_id=$1',[company.id]);await pool.query('DELETE FROM meeter.settings WHERE company_id=$1',[company.id]);await pool.query('DELETE FROM meeter.companies WHERE id=$1',[company.id]);}
 if(userId){
  const columns=(await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='neon_auth' AND column_name='emailVerified'")).rows;
  const table=columns[0]?.table_name;if(table && /^[A-Za-z_]+$/.test(table))await pool.query(`DELETE FROM neon_auth."${table}" WHERE id=$1`,[userId]);
 }
 await pool.end();
}
