// Run only during cutover, after stopping legacy writes and before enabling Demo users.
import {verifiedConnectionString} from '../server/env.mjs';
import pg from 'pg';
if(!process.env.DATABASE_URL_UNPOOLED)throw new Error('Falta DATABASE_URL_UNPOOLED.');
const client=new pg.Client({connectionString:verifiedConnectionString(process.env.DATABASE_URL_UNPOOLED)});
const demo='00000000-0000-4000-8000-000000000001';
try{
 await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(68214001)');
 if((await client.query('SELECT 1 FROM meeter.members WHERE company_id=$1 LIMIT 1',[demo])).rowCount)throw new Error('Demo ya tiene miembros; se rechaza sobrescribir sus datos.');
 for(const table of ['estimates','rate_catalog','cost_centers','excluded_emails','settings'])await client.query(`DELETE FROM meeter.${table} WHERE company_id=$1`,[demo]);
 await client.query('INSERT INTO meeter.settings SELECT $1,id,currency,default_hourly_cost FROM meeting_cost.settings',[demo]);
 await client.query('INSERT INTO meeter.rate_catalog(company_id,email,name,position,cost,currency,active) SELECT $1,email,name,position,cost,currency,active FROM meeting_cost.rate_catalog',[demo]);
 await client.query('INSERT INTO meeter.cost_centers SELECT $1,id,name FROM meeting_cost.cost_centers',[demo]);
 await client.query('INSERT INTO meeter.excluded_emails SELECT $1,email FROM meeting_cost.excluded_emails',[demo]);
 await client.query("INSERT INTO meeter.estimates(company_id,id,owner_email,created_at,report) SELECT $1,id,lower(coalesce(report->>'organizerEmail','legacy@demo.invalid')),created_at,report FROM meeting_cost.estimates",[demo]);
 await client.query('COMMIT');console.log('Demo sincronizada desde las tablas antiguas. No volver al modo anterior después del corte.');
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error(error.message);process.exitCode=1;}finally{await client.end();}
