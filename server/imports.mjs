import {RequestError} from './meetings.mjs';
export function csvRows(text){
 text=text.replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/)[0];const delimiter=first.includes(';')?';':',';
 let row=[],cell='',quoted=false,rows=[];
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted && (c===delimiter || c==='\n')){row.push(cell.trim());cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}
  else if(c!=='\r' || quoted)cell+=c;
 }
 if(quoted)throw new RequestError('CSV con comillas sin cerrar.');
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 const headers=rows.shift();if(!headers || new Set(headers).size!==headers.length)throw new RequestError('Cabeceras CSV inválidas.');
 return rows.map((values,i)=>{if(values.length!==headers.length)throw new RequestError(`Fila ${i+2}: número de columnas incorrecto.`);return Object.fromEntries(headers.map((h,j)=>[h,values[j]]));});
}
export function previewImport(input){
 const {kind,format,content}=input || {};
 if(!['employees','centers'].includes(kind) || !['csv','json'].includes(format) || typeof content!=='string')throw new RequestError('Importación inválida.');
 let rows;try{rows=format==='csv'?csvRows(content):JSON.parse(content);}catch(error){throw new RequestError(error.message);}
 if(!Array.isArray(rows) || rows.length>5000)throw new RequestError('Máximo 5000 filas.');
 const errors=[],seen=new Set();
 const normalized=rows.map((r,i)=>{
  if(!r || typeof r!=='object'){errors.push(`Fila ${i+1}: objeto inválido.`);return {};}
  let result;
  if(kind==='employees'){
   const rawCost=r.cost ?? r.hourlyRate;
   if(r.active!==undefined && ![true,false,'true','false',''].includes(r.active))errors.push(`Fila ${i+1}: active debe ser true o false.`);
   result={email:String(r.email || '').trim().toLowerCase(),name:String(r.name || '').trim(),position:String(r.position || '').trim(),cost:Number(rawCost),currency:String(r.currency || 'EUR').trim().toUpperCase(),active:!(r.active===false || r.active==='false')};
   if(!/^\S+@\S+\.\S+$/.test(result.email) || result.email.length>254 || result.name.length>500 || result.position.length>500 || rawCost===undefined || rawCost===null || String(rawCost).trim()==='' || !Number.isFinite(result.cost) || result.cost<0 || !/^[A-Z]{3}$/.test(result.currency))errors.push(`Fila ${i+1}: correo, tarifa o moneda inválidos.`);
  }else{result={id:String(r.id || '').trim(),name:String(r.name || '').trim()};if(!result.id || !result.name || result.id.length>100 || result.name.length>500)errors.push(`Fila ${i+1}: id o nombre inválidos.`);}
  const key=result.email || result.id;if(seen.has(key))errors.push(`Fila ${i+1}: identificador duplicado ${key}.`);seen.add(key);return result;
 });
 return {kind,rows:normalized,errors,valid:errors.length===0};
}
export async function applyImport(db,preview,mode){
 if(!preview.valid || !['merge','replace'].includes(mode))throw new RequestError('Corrige la importación o selecciona merge/replace.');
 const table=preview.kind==='employees'?'rate_catalog':'cost_centers';
 if(preview.kind==='employees'){
  const {rows}=await db.query('SELECT currency FROM meeting_cost.settings WHERE id=1');
  if(preview.rows.some(r=>r.currency!==rows[0].currency))throw new RequestError('Las tarifas deben usar la moneda de la empresa.');
 }
 if(mode==='replace')await db.query(`DELETE FROM meeting_cost.${table}`);
 for(const row of preview.rows){
  if(preview.kind==='employees')await db.query(`INSERT INTO meeting_cost.rate_catalog(email,name,position,cost,currency,active) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(company_id,email) DO UPDATE SET name=excluded.name,position=excluded.position,cost=excluded.cost,currency=excluded.currency,active=excluded.active`,[row.email,row.name,row.position,row.cost,row.currency,row.active]);
  else await db.query('INSERT INTO meeting_cost.cost_centers(id,name) VALUES($1,$2) ON CONFLICT(company_id,id) DO UPDATE SET name=excluded.name',[row.id,row.name]);
 }
 return {saved:preview.rows.length,mode};
}
