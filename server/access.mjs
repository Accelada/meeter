import './env.mjs';
import {timingSafeEqual} from 'node:crypto';

export function serviceConfig(env=process.env){
  const production=env.NODE_ENV==='production';
  const origin=new URL(env.PUBLIC_BASE_URL || 'https://localhost:3000');
  if(origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash || origin.protocol!=='https:')throw new Error('PUBLIC_BASE_URL debe ser un origen HTTPS sin ruta ni credenciales.');
  const apiKey=env.SERVICE_API_KEY || '';
  if(production && (apiKey.length<32 || !env.PUBLIC_BASE_URL || !env.DATABASE_URL))throw new Error('Producción requiere PUBLIC_BASE_URL, DATABASE_URL y SERVICE_API_KEY de al menos 32 caracteres.');
  const port=Number(env.PORT || 3000);
  if(!Number.isInteger(port) || port<1 || port>65535)throw new Error('PORT inválido.');
  const hostname=env.HOST || (production?'0.0.0.0':'127.0.0.1');
  if(!['127.0.0.1','localhost','::1'].includes(hostname) && apiKey.length<32)throw new Error('Escuchar fuera del equipo local requiere SERVICE_API_KEY de al menos 32 caracteres.');
  return {production,origin:origin.origin,apiKey,port,hostname,proxy:env.TLS_TERMINATION==='proxy'};
}
export const config=serviceConfig();
export function authenticated(req,key=config.apiKey){
  if(!key)return true; // Only allowed for local development by serviceConfig.
  const header=req.headers.authorization || '';
  let supplied='';
  if(header.startsWith('Bearer '))supplied=header.slice(7);
  else if(header.startsWith('Basic ')){
    const value=Buffer.from(header.slice(6),'base64').toString('utf8');
    if(value.startsWith('meeting-cost:'))supplied=value.slice('meeting-cost:'.length);
  }
  const expected=Buffer.from(key),actual=Buffer.from(supplied);
  return expected.length===actual.length && timingSafeEqual(expected,actual);
}
export function requireAccess(req,res){
  if(authenticated(req))return true;
  res.writeHead(401,{'WWW-Authenticate':'Basic realm="Meeting Cost", charset="UTF-8"','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify({error:'Acceso no autorizado.'}));return false;
}
export function allowedHost(req){
  const host=req.headers.host || '';
  const local=/^(localhost|127\.0\.0\.1):\d+$/.test(host);
  return config.production ? host===new URL(config.origin).host : local || host===new URL(config.origin).host;
}
export function allowedOrigin(req){
  if(!allowedHost(req))return false;
  const host=req.headers.host;
  const local=/^(localhost|127\.0\.0\.1):\d+$/.test(host);
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  const origin=req.headers.origin;
  return !origin || origin===config.origin || (!config.production && local && origin===`${req.socket.encrypted?'https':'http'}://${host}`);
}
