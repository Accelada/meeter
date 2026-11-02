import test from 'node:test';
import assert from 'node:assert/strict';
import {recurrenceSummary,fromOfficeRecurrence} from '../src/recurrence.js';
import {calculate} from '../src/calculator.js';
import {readMeeting} from '../src/outlook.js';
const base={startDate:'2026-11-02',endDate:'2026-11-30',interval:1};
test('diaria y semanal: extremos incluidos, varias fechas por semana e intervalos',()=>{
  assert.equal(recurrenceSummary({...base,type:'daily'}).occurrenceCount,29);
  assert.equal(recurrenceSummary({...base,type:'daily',interval:2}).occurrenceCount,15);
  assert.equal(recurrenceSummary({...base,type:'weekly'}).occurrenceCount,5);
  assert.equal(recurrenceSummary({...base,type:'weekly',days:['Mon','Thu']}).occurrenceCount,9);
  assert.equal(recurrenceSummary({...base,type:'weekly',interval:2,days:['Mon','Thu'],firstDayOfWeek:'Mon'}).occurrenceCount,5);
});
test('mensual con días 31 y febrero; último viernes y días laborables relativos',()=>{
  assert.equal(recurrenceSummary({type:'monthly',startDate:'2026-01-31',endDate:'2026-04-30',dayOfMonth:31}).occurrenceCount,4);
  assert.equal(recurrenceSummary({...base,type:'monthly',endDate:'2027-02-28',dayOfWeek:'fri',weekNumber:'last'}).occurrenceCount,4);
  assert.equal(recurrenceSummary({...base,type:'monthly',dayOfWeek:'weekday',weekNumber:'second'}).occurrenceCount,1);
});
test('anual y número de reuniones sin final implícito',()=>{
  assert.equal(recurrenceSummary({type:'yearly',startDate:'2024-02-29',endDate:'2028-02-29',month:'Feb',dayOfMonth:29}).occurrenceCount,5);
  assert.equal(recurrenceSummary({type:'weekly',startDate:'2026-11-02',numberOfOccurrences:10}).occurrenceCount,10);
});
test('series sin fin o API no disponible no inventan un total',()=>{
  assert.equal(recurrenceSummary({type:'weekly',startDate:'2026-11-02',endDate:null}).seriesStatus,'unbounded');
  assert.equal(recurrenceSummary({unavailable:true}).occurrenceCount,null);
  assert.equal(recurrenceSummary({...base,type:'daily',endDate:'9999-12-31'}).seriesStatus,'tooLarge');
});
test('errores de patrón, fechas y límites se rechazan',()=>{
  for(const pattern of [{...base,type:'weekly',interval:0},{...base,type:'weekly',days:['bad']},{...base,type:'daily',endDate:'2026-02-30'},{...base,type:'daily',endDate:'2026-01-01'},{...base,type:'monthly',dayOfMonth:32},{...base,type:'yearly',month:'bad'}])assert.throws(()=>recurrenceSummary(pattern));
});
test('coste por reunión y total de serie usan las mismas tarifas y duración',()=>{
  const config={currency:'EUR',defaultHourlyRate:40,employees:[{email:'a@example.com',hourlyRate:80}],costCenters:[{id:'A',name:'A'}]};
  const meeting={durationMinutes:30,attendees:[{email:'a@example.com'}],recurrence:{type:'weekly',startDate:'2026-11-02',numberOfOccurrences:10}};
  const result=calculate(meeting,config);assert.equal(result.total,40);assert.equal(result.seriesTotal,400);assert.equal(result.occurrenceCount,10);
  assert.equal(calculate({...meeting,recurrence:{...meeting.recurrence,numberOfOccurrences:undefined}},config).seriesTotal,null);
  assert.equal(calculate({...meeting,recurrence:null},config).isRecurring,false);
});
test('Office SeriesTime se convierte en datos JSON y usa duración habitual de la serie',async()=>{
  const recurrence={recurrenceType:'weekly',recurrenceProperties:{interval:1,days:['Mon']},seriesTime:{getStartDate:()=>base.startDate,getEndDate:()=>base.endDate,getDuration:()=>30}};
  assert.equal(fromOfficeRecurrence(recurrence).endDate,base.endDate);
  const prop=value=>({getAsync:cb=>cb({status:'succeeded',value})});
  const meeting=await readMeeting({requiredAttendees:prop([]),optionalAttendees:prop([]),start:prop('2026-11-02T10:00:00Z'),end:prop('2026-11-02T11:00:00Z'),organizer:prop({emailAddress:'a@example.com'}),subject:prop('Serie'),recurrence:prop(recurrence)});
  assert.equal(meeting.durationMinutes,30);assert.equal(recurrenceSummary(meeting.recurrence).occurrenceCount,5);
});
