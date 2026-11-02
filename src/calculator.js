export const normalizeEmail = value => String(value || '').trim().toLowerCase();
export function validateRates(config) {
  if (!config || !Number.isFinite(config.defaultHourlyRate) || config.defaultHourlyRate < 0) throw new Error('defaultHourlyRate debe ser un número no negativo.');
  if (!/^[A-Z]{3}$/.test(config.currency || '')) throw new Error('currency debe ser un código como EUR.');
  try { new Intl.NumberFormat('es-ES', {style:'currency',currency:config.currency}); } catch { throw new Error('Moneda no válida.'); }
  if (!Array.isArray(config.employees)) throw new Error('employees debe ser una lista.');
  const emails = new Set();
  for (const person of config.employees) {
    const email = normalizeEmail(person.email);
    if (!email.includes('@') || emails.has(email)) throw new Error('Correo inválido o duplicado en tarifas: ' + email);
    if (!Number.isFinite(person.hourlyRate) || person.hourlyRate < 0) throw new Error('Tarifa inválida para ' + email);
    emails.add(email);
  }
  if (!Array.isArray(config.costCenters) || !config.costCenters.length || config.costCenters.some(c=>!c.id || !c.name)) throw new Error('Debe existir al menos un centro de coste con id y name.');
  return config;
}
export function calculate({attendees, durationMinutes, recurrence}, config, overrides = {}) {
  validateRates(config);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error('La duración debe ser mayor que cero.');
  const known = new Map(config.employees.map(p => [normalizeEmail(p.email), p]));
  const excluded = new Set((config.excludedEmails || []).map(normalizeEmail));
  const unique = new Map();
  for (const p of attendees) {
    const email = normalizeEmail(p.email);
    if (!email || !email.includes('@') || p.isResource || excluded.has(email)) continue;
    if (!unique.has(email)) unique.set(email, p);
  }
  const people = [...unique].map(([email,p]) => {
    const record = known.get(email);
    const manual = Object.hasOwn(overrides,email);
    const rate = manual ? overrides[email] : record?.hourlyRate ?? config.defaultHourlyRate;
    if (!Number.isFinite(rate) || rate < 0) throw new Error('Tarifa manual inválida.');
    return {email, name:p.name || email, position:record?.position || 'Sin categoría', hourlyRate:rate,
      source:manual?'manual':record?'catalog':'default', cost:rate * durationMinutes / 60};
  });
  const hourlyTotal = people.reduce((sum,p)=>sum+p.hourlyRate,0);
  const series=recurrenceSummary(recurrence);
  const total=hourlyTotal*durationMinutes/60;
  return {status:'estimated',currency:config.currency,durationMinutes,people,personCount:people.length,
    hourlyTotal,costPerMinute:hourlyTotal/60,total,...series,seriesTotal:series.occurrenceCount===null?null:total*series.occurrenceCount,
    personHours:people.length*durationMinutes/60,unknownCount:people.filter(p=>p.source==='default').length};
}
import {recurrenceSummary} from './recurrence.js';
