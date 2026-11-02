import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticated,serviceConfig,allowedHost,allowedOrigin} from '../server/access.mjs';
import {meetingIds,selectedAttribute,findMeetings} from '../server/meetings.mjs';
import {manifest} from '../server/manifest.mjs';

test('IDs individuales y lotes limitados; entradas ambiguas o excesivas se rechazan',()=>{
  assert.deepEqual(meetingIds({id:'ews/id+='}),['ews/id+=']);
  assert.deepEqual(meetingIds({ids:['a','b','a']}),['a','b']);
  for(const value of [{},{ids:[]},{ids:Array(101).fill('a')},{id:'x',ids:['y']},{id:42}])assert.throws(()=>meetingIds(value));
});
test('el documento permite iframe de Outlook pero la API rechaza peticiones cross-site',()=>{
  const req={headers:{host:'localhost:3000','sec-fetch-site':'cross-site','sec-fetch-dest':'iframe'},socket:{encrypted:true}};
  assert.equal(allowedHost(req),true);assert.equal(allowedOrigin(req),false);
  assert.equal(allowedOrigin({...req,headers:{host:'localhost:3000','sec-fetch-site':'same-origin',origin:'https://localhost:3000'}}),true);
  assert.equal(allowedHost({...req,headers:{host:'attacker.example.com'}}),false);
});
test('atributos explícitos y flags; nombres arbitrarios no acceden al documento',()=>{
  for(const query of ['id=x&attribute=durationMinutes','id=x&durationMinutes'])assert.equal(selectedAttribute(new URL(`https://example.com/?${query}`)),'durationMinutes');
  for(const query of ['id=x&attribute=__proto__','id=x&privateField','id=x&total&currency','id=x&id=y'])assert.throws(()=>selectedAttribute(new URL(`https://example.com/?${query}`)));
});
test('producción y bind público requieren URL HTTPS, base y secreto',()=>{
  assert.throws(()=>serviceConfig({NODE_ENV:'production'}));
  assert.throws(()=>serviceConfig({HOST:'0.0.0.0'}));
  assert.throws(()=>serviceConfig({PUBLIC_BASE_URL:'http://example.com'}));
  const value=serviceConfig({NODE_ENV:'production',PUBLIC_BASE_URL:'https://coste.example.com',DATABASE_URL:'postgresql://unused',SERVICE_API_KEY:'a'.repeat(32),TLS_TERMINATION:'proxy'});
  assert.equal(value.hostname,'0.0.0.0');assert.equal(value.origin,'https://coste.example.com');assert.equal(value.proxy,true);
});
test('autenticación Bearer/Basic, sin secretos en URL o manifest',()=>{
  const key='token-de-prueba-largo';
  assert.ok(authenticated({headers:{authorization:`Bearer ${key}`}},key));
  assert.ok(authenticated({headers:{authorization:`Basic ${Buffer.from(`meeting-cost:${key}`).toString('base64')}`}},key));
  assert.equal(authenticated({headers:{}},key),false);
  assert.equal(authenticated({headers:{authorization:'Bearer incorrecto'}},key),false);
});
test('manifiesto para otro servidor reemplaza todas las referencias localhost',async()=>{
  const xml=await manifest('https://coste.example.com');
  assert.ok(!xml.includes('localhost'));assert.match(xml,/https:\/\/coste.example.com\/commands.html/);assert.match(xml,/ItemSend/);
  await assert.rejects(()=>manifest('https://example.com/path'));
});
test('consulta por ID usa parámetros SQL y conserva IDs no encontrados',async()=>{
  let sqlValues;
  const pool={query:async(sql,values)=>{sqlValues=values;return {rows:[{id:'uuid',createdAt:'date',report:{outlookItemId:'ews',durationMinutes:30}}]};}};
  const found=await findMeetings(pool,['ews','uuid',"' OR 1=1"]);
  assert.equal(found.meetings.length,1);assert.deepEqual(found.missingIds,["' OR 1=1"]);assert.deepEqual(sqlValues,[['ews','uuid',"' OR 1=1"]]);
});
