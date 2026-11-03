import {pool,getRates} from './database.mjs';
import {RequestError} from './meetings.mjs';
export async function tenantTransaction(company,action){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SET LOCAL ROLE meeter_tenant');
  await client.query("SELECT set_config('meeter.company_id',$1,true),set_config('meeter.email',$2,true),set_config('meeter.admin',$3,true)",[company.id,company.email, String(company.role==='admin')]);
  const db={query:(sql,values)=>client.query(sql.replaceAll('meeting_cost.','meeter.').replace('ON CONFLICT (id)','ON CONFLICT (company_id,id)'),values)};
  const result=await action(db);
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function companyRates(company){return tenantTransaction(company,db=>getRates(db));}
export async function createCompany(input){
 if(!input || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.slug) || typeof input.name!=='string' || !input.name.trim() || input.name.length>160)throw new RequestError('Nombre o identificador de empresa inválido.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows}=await client.query('INSERT INTO meeter.companies(slug,name) VALUES($1,$2) RETURNING *',[input.slug,input.name.trim()]);
  await client.query('SET LOCAL ROLE meeter_tenant');
  await client.query("SELECT set_config('meeter.company_id',$1,true),set_config('meeter.email','operator@meeter.invalid',true),set_config('meeter.admin','true',true)",[rows[0].id]);
  await client.query('INSERT INTO meeter.settings(currency,default_hourly_cost) VALUES(\'EUR\',0)');
  // No sample employees, meetings, or cost centres are copied.
  await client.query('COMMIT');return rows[0];
 }catch(error){await client.query('ROLLBACK');if(error.code==='23505')throw new RequestError('El identificador de empresa ya existe.',409);throw error;}finally{client.release();}
}
