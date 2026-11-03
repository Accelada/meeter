import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompanySession,storeCompanySession} from '../src/company-client.js';
const key='meeter.company.session';
function fixture(email='ana@empresa.com'){
 const values=new Map(),cache=new Map();
 const office={context:{mailbox:{userProfile:{emailAddress:email}},roamingSettings:{get:k=>values.get(k),set:(k,v)=>values.set(k,v),remove:k=>values.delete(k),saveAsync:cb=>cb({status:'succeeded'})}}};
 const storage={getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)};
 return {office,storage,values,cache};
}
const session={slug:'empresa',token:'mt_test',expiresAt:'2030-01-01T00:00:00Z'};
test('Outlook connection survives a stale roaming snapshot after reload',async()=>{
 const f=fixture();await storeCompanySession(session,f.office,f.storage);
 assert.equal(readCompanySession(f.office,f.storage).token,'mt_test');
 f.values.clear();assert.equal(readCompanySession(f.office,f.storage).token,'mt_test');
 const other=fixture('otro@empresa.com');assert.equal(readCompanySession(other.office,f.storage),null);
});
test('new connection wins over older Office data without crossing mailboxes',async()=>{
 const f=fixture();await storeCompanySession(session,f.office,f.storage);
 f.values.set(key,{...session,slug:'old-company',savedAt:1});
 assert.equal(readCompanySession(f.office,f.storage).slug,'empresa');
});
test('roaming save failure does not report success or cache the new credentials',async()=>{
 const f=fixture();f.office.context.roamingSettings.saveAsync=cb=>cb({status:'failed'});
 await assert.rejects(()=>storeCompanySession(session,f.office,f.storage),/No se pudo recordar/);
 assert.equal(f.cache.size,0);assert.equal(readCompanySession(f.office,f.storage),null);
});
test('Office works when browser storage is blocked',async()=>{
 const f=fixture();const blocked={getItem:()=>{throw new Error();},setItem:()=>{throw new Error();}};
 await storeCompanySession(session,f.office,blocked);assert.equal(readCompanySession(f.office,blocked).token,'mt_test');
});
