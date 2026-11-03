import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSend} from '../src/on-send.js';

function setup({itemType='appointment',saveFails=false}={}) {
  const values=new Map([['meetingCostCenter','ATLAS-001']]);
  const property=value=>({getAsync:cb=>cb({status:'succeeded',value})});
  const completions=[],notifications=[];
  const properties={get:key=>values.get(key),set:(key,value)=>values.set(key,value),saveAsync:cb=>cb({status:saveFails?'failed':'succeeded'})};
  const item={itemType,requiredAttendees:property([{emailAddress:'junior@ejemplo.com',displayName:'Junior'}]),optionalAttendees:property([]),
    start:property('2026-11-02T10:00:00Z'),end:property('2026-11-02T10:30:00Z'),subject:property('Prueba sin envío'),
    organizer:property({emailAddress:'organizador@ejemplo.com',displayName:'Organizador'}),
    loadCustomPropertiesAsync:cb=>cb({status:'succeeded',value:properties}),saveAsync:cb=>cb({status:'succeeded'}),
    notificationMessages:{addAsync:(key,message)=>notifications.push(message)}};
  return {office:{context:{mailbox:{item}}},event:{completed:result=>completions.push(result)},completions,notifications,values};
}
test('ItemSend lee la reunión actual y guarda antes de permitir enviar; reutiliza el ID',async()=>{
  const state=setup();const payloads=[];
  const fetchImpl=async(path,options)=>{assert.equal(state.completions.length,payloads.length);const data=JSON.parse(options.body);payloads.push(data);return {ok:true,json:async()=>({id:data.requestId})};};
  await handleSend(state.event,{office:state.office,fetchImpl});
  assert.deepEqual(state.completions,[{allowEvent:true}]);
  assert.equal(payloads[0].source,'outlook');assert.equal(payloads[0].costCenterId,'ATLAS-001');
  assert.equal(payloads[0].meeting.durationMinutes,30);assert.equal(payloads[0].meeting.attendees.length,2);
  await handleSend(state.event,{office:state.office,fetchImpl});
  assert.equal(payloads[0].requestId,payloads[1].requestId);
});
test('un correo no dispara guardado de estimaciones',async()=>{
  const state=setup({itemType:'message'});
  await handleSend(state.event,{office:state.office,fetchImpl:()=>assert.fail('No debe contactar con Neon')});
  assert.deepEqual(state.completions,[{allowEvent:true}]);
});
test('ItemSend utiliza la empresa y credencial personal guardadas en Outlook',async()=>{
 const state=setup();
 state.office.context.roamingSettings={get:()=>({slug:'empresa-a',token:'mt_test',expiresAt:new Date(Date.now()+60000).toISOString()})};
 await handleSend(state.event,{office:state.office,fetchImpl:async(path,options)=>{
  assert.equal(path,'/api/companies/empresa-a/estimates');assert.equal(options.headers.Authorization,'Bearer mt_test');
  assert.equal(state.values.has('meeter.company.session'),false);
  return {ok:true,json:async()=>({id:'saved'})};
 }});assert.deepEqual(state.completions,[{allowEvent:true}]);
});
test('una credencial caducada no dispara una petición de guardado',async()=>{
 const state=setup();state.office.context.roamingSettings={get:()=>({slug:'empresa-a',token:'mt_test',expiresAt:'2020-01-01'})};
 await handleSend(state.event,{office:state.office,fetchImpl:()=>assert.fail('No debe usar la sesión caducada')});assert.deepEqual(state.completions,[{allowEvent:false}]);
});
test('un borrador de otra empresa exige confirmar la selección en el panel',async()=>{
 const state=setup();state.values.set('meeterCompanySlug','empresa-b');state.office.context.roamingSettings={get:()=>({slug:'empresa-a',token:'mt_test',expiresAt:new Date(Date.now()+60000).toISOString()})};
 await handleSend(state.event,{office:state.office,fetchImpl:()=>assert.fail('No debe registrar el borrador en otra empresa')});assert.deepEqual(state.completions,[{allowEvent:false}]);
});
test('si PostgreSQL falla, bloquea el envío y muestra aviso',async()=>{
  const state=setup();await handleSend(state.event,{office:state.office,fetchImpl:async()=>({ok:false})});
  assert.deepEqual(state.completions,[{allowEvent:false}]);assert.equal(state.notifications.length,1);
});
test('si no puede persistir las propiedades, no guarda una estimación sin identidad',async()=>{
  const state=setup({saveFails:true});await handleSend(state.event,{office:state.office,fetchImpl:()=>assert.fail('No debe guardar')});
  assert.deepEqual(state.completions,[{allowEvent:false}]);
});
test('tiempo de espera: termina una vez y no permite un envío sin registro confirmado',async()=>{
  const state=setup();await handleSend(state.event,{office:state.office,fetchImpl:()=>new Promise(()=>{}),timeoutMs:10});
  assert.deepEqual(state.completions,[{allowEvent:false}]);
});
