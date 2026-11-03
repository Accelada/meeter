import {verifiedConnectionString} from './env.mjs';
import pg from 'pg';
import {validateRates} from '../src/calculator.js';

export const databaseEnabled = Boolean(process.env.DATABASE_URL);
export const pool = databaseEnabled ? new pg.Pool({
  connectionString: verifiedConnectionString(process.env.DATABASE_URL),
  max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000,
  query_timeout: 15000,
}) : null;
pool?.on('error', () => console.error('Conexión PostgreSQL interrumpida.'));

export async function getRates(db=pool) {
  if (!db) throw new Error('DATABASE_URL no configurada.');
  const {rows} = await db.query(`SELECT jsonb_build_object(
    'currency', s.currency, 'defaultHourlyRate', s.default_hourly_cost::float8,
    'employees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',employee_id,'email',email,'name',name,'position',position,'hourlyRate',cost::float8) ORDER BY employee_id),'[]'::jsonb) FROM meeting_cost.rate_catalog WHERE active),
    'costCenters', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id),'[]'::jsonb) FROM meeting_cost.cost_centers),
    'excludedEmails', (SELECT coalesce(jsonb_agg(email ORDER BY email),'[]'::jsonb) FROM meeting_cost.excluded_emails)
  ) AS config FROM meeting_cost.settings s WHERE s.id=1`);
  if (!rows.length) throw new Error('Ejecuta npm run db:migrate.');
  return validateRates(rows[0].config);
}
