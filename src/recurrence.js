const DAY=86400000;
const days=['sun','mon','tue','wed','thu','fri','sat'];
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const token=value=>String(value || '').toLowerCase();
function date(value){
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Fecha de periodicidad inválida.');
  const result=new Date(`${value}T00:00:00Z`);
  if(!Number.isFinite(result.getTime()) || result.toISOString().slice(0,10)!==value)throw new Error('Fecha de periodicidad inválida.');
  return result;
}
function daySet(value){
  const key=token(value);
  if(key==='day')return [0,1,2,3,4,5,6];
  if(key==='weekday')return [1,2,3,4,5];
  if(key==='weekendday')return [0,6];
  const index=days.indexOf(key.slice(0,3));
  if(index<0)throw new Error('Día de periodicidad inválido.');
  return [index];
}
export function recurrenceSummary(recurrence){
  if(recurrence==null)return {isRecurring:false,occurrenceCount:1,seriesStatus:'single'};
  if(recurrence.unavailable===true)return {isRecurring:null,occurrenceCount:null,seriesStatus:'unavailable'};
  if(typeof recurrence!=='object' || Array.isArray(recurrence))throw new Error('Periodicidad inválida.');
  const {type,startDate,endDate,numberOfOccurrences}=recurrence;
  const interval=recurrence.interval ?? 1;
  if(!['daily','weekly','monthly','yearly'].includes(type) || !Number.isInteger(interval) || interval<1 || interval>999)throw new Error('Patrón de periodicidad inválido.');
  const start=date(startDate);
  if(numberOfOccurrences!==undefined && (!Number.isInteger(numberOfOccurrences) || numberOfOccurrences<1 || numberOfOccurrences>100000))throw new Error('Número de reuniones inválido.');
  const end=endDate?date(endDate):null;
  if(end && end<start)throw new Error('El fin de la serie es anterior a su inicio.');
  const first=daySet(recurrence.firstDayOfWeek || 'sun')[0];
  const weekly=type==='weekly'?(recurrence.days || [days[start.getUTCDay()]]).flatMap(daySet):[];
  if(type==='weekly' && (!weekly.length || weekly.length>7))throw new Error('Días de periodicidad inválidos.');
  const relative=recurrence.dayOfWeek!==undefined;
  const ordinal={first:0,second:1,third:2,fourth:3,last:-1}[token(recurrence.weekNumber)];
  if(relative && ordinal===undefined)throw new Error('Ordinal de periodicidad inválido.');
  const relativeDays=relative?daySet(recurrence.dayOfWeek):[];
  const dayOfMonth=recurrence.dayOfMonth ?? start.getUTCDate();
  if(!Number.isInteger(dayOfMonth) || dayOfMonth<1 || dayOfMonth>31)throw new Error('Día del mes inválido.');
  const month=recurrence.month===undefined?start.getUTCMonth():months.indexOf(token(recurrence.month).slice(0,3));
  if(type==='yearly' && month<0)throw new Error('Mes de periodicidad inválido.');
  if(!end && numberOfOccurrences===undefined)return {isRecurring:true,occurrenceCount:null,seriesStatus:'unbounded'};
  // Bound CPU use for untrusted API inputs. Never present a truncated total.
  const maxDays=366*200;
  if(end && (end-start)/DAY>maxDays)return {isRecurring:true,occurrenceCount:null,seriesStatus:'tooLarge'};
  let count=0;
  const startWeek=start.getTime()-((start.getUTCDay()-first+7)%7)*DAY;
  for(let offset=0;offset<=maxDays;offset++){
    const current=new Date(start.getTime()+offset*DAY);
    if(end && current>end)break;
    const year=current.getUTCFullYear(),monthIndex=current.getUTCMonth();
    let matches=false;
    if(type==='daily')matches=offset%interval===0;
    if(type==='weekly')matches=Math.floor((current.getTime()-startWeek)/DAY/7)%interval===0 && weekly.includes(current.getUTCDay());
    if(type==='monthly' || type==='yearly'){
      const delta=(year-start.getUTCFullYear())*12+monthIndex-start.getUTCMonth();
      const eligible=type==='monthly'?delta%interval===0:monthIndex===month && (year-start.getUTCFullYear())%interval===0;
      if(eligible){
        const length=new Date(Date.UTC(year,monthIndex+1,0)).getUTCDate();
        let target=Math.min(dayOfMonth,length);
        if(relative){
          const candidates=[];
          for(let n=1;n<=length;n++)if(relativeDays.includes(new Date(Date.UTC(year,monthIndex,n)).getUTCDay()))candidates.push(n);
          target=ordinal===-1?candidates.at(-1):candidates[ordinal];
        }
        matches=current.getUTCDate()===target;
      }
    }
    if(matches)count++;
    if(numberOfOccurrences!==undefined && count===numberOfOccurrences)return {isRecurring:true,occurrenceCount:count,seriesStatus:'finite'};
  }
  if(!end)return {isRecurring:true,occurrenceCount:null,seriesStatus:'tooLarge'};
  if(!count)throw new Error('La serie no contiene reuniones en ese intervalo.');
  if(numberOfOccurrences!==undefined && count<numberOfOccurrences)throw new Error('El número de reuniones no cabe en las fechas de la serie.');
  return {isRecurring:true,occurrenceCount:count,seriesStatus:'finite'};
}

export function fromOfficeRecurrence(value){
  if(value==null)return null;
  const time=value.seriesTime;
  if(!time?.getStartDate || !time?.getEndDate)throw new Error('Outlook no devolvió las fechas de la serie.');
  return {type:token(value.recurrenceType),...value.recurrenceProperties,
    startDate:time.getStartDate(),endDate:time.getEndDate() || null};
}
