import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculate,validateRates} from '../src/calculator.js';
const config=JSON.parse(await readFile(new URL('../data/rates.json',import.meta.url),'utf8'));
test('incluye organizador, normaliza duplicados y excluye recursos',()=>{
 const r=calculate({durationMinutes:30,attendees:[{email:'organizador@ejemplo.com'},{email:' JUNIOR@ejemplo.com '},{email:'junior@ejemplo.com'},{email:'sala@ejemplo.com'},{email:'otra@ejemplo.com',isResource:true}]},config);
 assert.equal(r.total,47.5);assert.equal(r.personCount,2);assert.equal(r.personHours,1);
});
test('tarifa desconocida, cero y override',()=>{
 const m={durationMinutes:20,attendees:[{email:'nuevo@ejemplo.com'}]};
 assert.equal(calculate(m,config).unknownCount,1);
 assert.equal(calculate(m,config,{'nuevo@ejemplo.com':0}).total,0);
 assert.equal(calculate(m,config,{'nuevo@ejemplo.com':60}).total,20);
});
test('rechaza duración o tarifas no válidas y duplicados en catálogo',()=>{
 assert.throws(()=>calculate({durationMinutes:0,attendees:[]},config));
 assert.throws(()=>validateRates({...config,defaultHourlyRate:-1}));
 assert.throws(()=>validateRates({...config,employees:[config.employees[0],config.employees[0]]}));
});
test('cambio de duración recalcula sin redondear cada persona',()=>{
 const attendees=[{email:'organizador@ejemplo.com'},{email:'junior@ejemplo.com'},{email:'senior@ejemplo.com'},{email:'director@ejemplo.com'}];
 assert.equal(calculate({durationMinutes:30,attendees},config).total,122.5);
 assert.equal(calculate({durationMinutes:60,attendees},config).total,245);
});
