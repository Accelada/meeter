export const attributes=new Set(['subject','start','end','durationMinutes','personCount','total','currency','hourlyTotal','costPerMinute','personHours','unknownCount','people','costCenter','organizerEmail','outlookItemId','status','source','generatedAt','captureEvent','recurrence','isRecurring','occurrenceCount','seriesTotal','seriesStatus']);
export class RequestError extends Error {constructor(message,status=400){super(message);this.status=status;}}
export function meetingIds(input){
  if(input?.id!==undefined && input?.ids!==undefined)throw new RequestError('Usa id o ids, no ambos.');
  const ids=Array.isArray(input?.ids)?input.ids:input?.id!==undefined?[input.id]:null;
  if(!ids || !ids.length || ids.length>100 || ids.some(id=>typeof id!=='string' || !id.length || id.length>2048))throw new RequestError('Indica id o una lista ids de entre 1 y 100 identificadores.');
  return [...new Set(ids)];
}
export function selectedAttribute(url){
  for(const key of url.searchParams.keys())if(key!=='id' && key!=='attribute' && !attributes.has(key))throw new RequestError('Parámetro desconocido.');
  if(url.searchParams.getAll('id').length!==1 || url.searchParams.getAll('attribute').length>1)throw new RequestError('Indica un solo id y un solo atributo.');
  const named=url.searchParams.get('attribute');
  const flags=[...attributes].filter(key=>url.searchParams.has(key));
  if(flags.length>1 || (named && flags.length))throw new RequestError('Solicita un solo atributo por consulta.');
  const attribute=named || flags[0];
  if(attribute && !attributes.has(attribute))throw new RequestError('Atributo desconocido.');
  return attribute;
}
export async function findMeetings(pool,ids){
  const {rows}=await pool.query(`SELECT id, created_at AS "createdAt", report FROM meeting_cost.estimates
    WHERE id::text=ANY($1::text[]) OR report->>'outlookItemId'=ANY($1::text[])`,[ids]);
  const found=[];const missingIds=[];
  for(const id of ids){
    const matches=rows.filter(row=>row.id===id || row.report.outlookItemId===id);
    if(!matches.length)missingIds.push(id);
    else if(matches.length>1)throw new RequestError('El ID de Outlook corresponde a varias estimaciones; consulta por UUID interno.',409);
    else if(!found.some(row=>row.id===matches[0].id))found.push(matches[0]);
  }
  return {meetings:found.map(({id,createdAt,report})=>({id,createdAt,...report})),missingIds};
}
