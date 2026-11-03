import {verifiedConnectionString} from '../server/env.mjs';
import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {validateRates} from '../src/calculator.js';

if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('Falta DATABASE_URL_UNPOOLED para migraciones.');
const client = new pg.Client({connectionString: verifiedConnectionString(process.env.DATABASE_URL_UNPOOLED), connectionTimeoutMillis: 15000});
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(68214001)");
  await client.query('CREATE SCHEMA IF NOT EXISTS meeting_cost');
  await client.query('CREATE TABLE IF NOT EXISTS meeting_cost.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  // Adopt installations created before the version ledger existed; never reseed a relational catalog.
  const installed=await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='meeting_cost'");
  const has=(table,column)=>installed.rows.some(r=>r.table_name===table && r.column_name===column);
  if(has('rate_catalog','cost') && has('rate_catalog_legacy','config') && has('settings','default_hourly_cost') && has('cost_centers','id') && has('excluded_emails','email') && has('estimates','report')){
    for(const name of ['001_meeting_cost.sql','002_relational_catalog.sql'])await client.query('INSERT INTO meeting_cost.schema_migrations(name) VALUES($1) ON CONFLICT DO NOTHING',[name]);
  }
  const directory=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(directory)).filter(name=>/^\d+_.+\.sql$/.test(name)).sort()){
    if((await client.query('SELECT 1 FROM meeting_cost.schema_migrations WHERE name=$1',[name])).rowCount)continue;
    await client.query(await readFile(new URL(name,directory),'utf8'));
    if(name==='001_meeting_cost.sql'){
      const config=validateRates(JSON.parse(await readFile(new URL('../data/rates.json',import.meta.url),'utf8')));
      await client.query('INSERT INTO meeting_cost.rate_catalog (id, config) VALUES (1, $1) ON CONFLICT (id) DO NOTHING',[JSON.stringify(config)]);
    }
    await client.query('INSERT INTO meeting_cost.schema_migrations (name) VALUES ($1)',[name]);
    console.log(`Migración aplicada: ${name}`);
  }
  await client.query('COMMIT');
  console.log('Migraciones OK; datos existentes conservados.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migración fallida:', error.code || error.name, error.message);
  process.exitCode = 1;
} finally { await client.end(); }
