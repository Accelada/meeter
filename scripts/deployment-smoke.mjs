import '../server/env.mjs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const probe=net.createServer();
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const key=randomBytes(32).toString('hex');
const child=spawn(process.execPath,['scripts/server.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),
  env:{...process.env,NODE_ENV:'production',PUBLIC_BASE_URL:'https://coste.example.com',SERVICE_API_KEY:key,TLS_TERMINATION:'proxy',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
function request(path,{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:'coste.example.com',...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));
    });req.on('error',reject);req.end(body);
  });
}
try{
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Servidor de prueba no disponible.')),10000);
    child.stdout.on('data',chunk=>{if(String(chunk).includes('Meeting Cost:')){clearTimeout(timer);resolve();}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('El servidor de prueba terminó prematuramente.'));});
  });
  assert.equal((await request('/healthz')).status,200);
  assert.equal((await request('/taskpane.html')).status,401);
  assert.equal((await request('/api/rates')).status,401);
  const headers={Authorization:`Bearer ${key}`};
  assert.equal((await request('/api/rates',{headers})).status,200);
  const basic={Authorization:`Basic ${Buffer.from(`meeting-cost:${key}`).toString('base64')}`};
  assert.equal((await request('/taskpane.html',{headers:basic})).status,200);
  assert.equal((await request('/taskpane.html',{headers:{...basic,'Sec-Fetch-Site':'cross-site','Sec-Fetch-Dest':'iframe'}})).status,200);
  assert.equal((await request('/commands.html',{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Dest':'iframe'}})).status,200);
  assert.equal((await request('/api/rates',{headers:{...headers,'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await request('/api/rates',{headers:{...headers,Origin:'https://other.example.com'}})).status,403);
  const xml=await request('/manifest.xml');assert.equal(xml.status,200);assert.ok(!xml.text.includes('localhost'));assert.ok(xml.text.includes('https://coste.example.com/taskpane.html'));
  assert.equal((await request('/data/rates.json')).status,404);
  assert.equal((await request('/.env.local')).status,404);
  const queried=await request('/api/v1/meetings/query',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ids:['not-registered']})});
  assert.equal(queried.status,200);assert.deepEqual(JSON.parse(queried.text).missingIds,['not-registered']);
  const spec=await request('/api/openapi.json',{headers});assert.equal(spec.status,200);assert.equal(JSON.parse(spec.text).openapi,'3.1.0');
  console.log('PASS producción detrás de proxy: Host público, 401 sin clave, Bearer/Basic 200 y origen ajeno 403');
  console.log('PASS manifiesto remoto sin localhost, archivos privados 404 y API por POST con autenticación');
}finally{
  const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await stopped;
}
