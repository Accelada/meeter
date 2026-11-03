import test from 'node:test';
import assert from 'node:assert/strict';
import {csvRows,previewImport} from '../server/imports.mjs';
test('CSV accepts BOM, quoted commas, multiline fields and semicolon separator',()=>{
 assert.deepEqual(csvRows('\uFEFFemail;name;cost\r\na@b.com;"Ana; María";45'),[{email:'a@b.com',name:'Ana; María',cost:'45'}]);
 assert.deepEqual(csvRows('id,name\nCC1,"Equipo,\nProducto"'),[{id:'CC1',name:'Equipo,\nProducto'}]);
 assert.throws(()=>csvRows('id,name\n1,"sin cierre'));
 assert.throws(()=>csvRows('id,name\n1'));
});
test('imports normalize identifiers and reject duplicates, empty costs and invalid numbers',()=>{
 const good=previewImport({kind:'employees',format:'json',content:JSON.stringify([{email:' ANA@B.COM ',name:'Ana',cost:45,currency:'eur'}])});
 assert.equal(good.valid,true);assert.equal(good.rows[0].email,'ana@b.com');assert.equal(good.rows[0].currency,'EUR');
 for(const values of [[{email:'x@y.com',cost:''}],[{email:'x@y.com',cost:-1}],[{email:'x@y.com',cost:4},{email:'X@Y.COM',cost:5}]])assert.equal(previewImport({kind:'employees',format:'json',content:JSON.stringify(values)}).valid,false);
 assert.equal(previewImport({kind:'centers',format:'csv',content:'id,name\nCC1,Equipo'}).valid,true);
 assert.equal(previewImport({kind:'centers',format:'csv',content:'id,name\nCC1,'}).valid,false);
});
