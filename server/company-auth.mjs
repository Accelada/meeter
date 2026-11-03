import {createHash,randomBytes} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {pool} from './database.mjs';
import {authenticated,config} from './access.mjs';
import {RequestError} from './meetings.mjs';
export const multiTenant=()=>process.env.MEETER_MULTI_TENANT==='true';
const hash=token=>createHash('sha256').update(token).digest('hex');
let jwks;
export const isOperator=req=>Boolean(config.apiKey && authenticated(req));
export async function verifiedIdentity(req){
 const token=req.headers.authorization?.replace(/^Bearer /,'');
 if(!token || token===req.headers.authorization)throw new RequestError('Inicia sesión.',401);
 const base=process.env.NEON_AUTH_BASE_URL;
 if(!base)throw new RequestError('Configura Neon Auth en el servidor.',503);
 try{
  jwks ||= createRemoteJWKSet(new URL(`${base.replace(/\/$/,'')}/.well-known/jwks.json`));
  const {payload}=await jwtVerify(token,jwks,{issuer:new URL(base).origin,algorithms:['EdDSA'],requiredClaims:['sub','exp','email']});
  if(payload.emailVerified!==true)throw new Error('email');
  return {email:String(payload.email).trim().toLowerCase(),subject:payload.sub};
 }catch{throw new RequestError('Inicia sesión con un correo verificado.',401);}
}
export async function companyAccess(req,slug,{identityOnly=false}={}){
 const {rows}=await pool.query('SELECT id,slug,name FROM meeter.companies WHERE slug=$1',[slug]);
 if(!rows.length)throw new RequestError('Empresa no encontrada o sin acceso.',404);
 const company=rows[0];
 if(isOperator(req))return {...company,email:'operator@meeter.invalid',role:'admin',operator:true};
 let email;
 const token=req.headers.authorization?.slice(7);
 if(!identityOnly && req.headers.authorization?.startsWith('Bearer mt_')){
  const result=await pool.query('SELECT email FROM meeter.device_sessions WHERE token_hash=$1 AND company_id=$2 AND expires_at>now()',[hash(token),company.id]);
  email=result.rows[0]?.email;if(!email)throw new RequestError('La sesión ha caducado. Abre el panel e inicia sesión.',401);
 }else email=(await verifiedIdentity(req)).email;
 const member=await pool.query('SELECT role FROM meeter.members WHERE company_id=$1 AND email=$2 AND active',[company.id,email]);
 if(!member.rowCount)throw new RequestError('Empresa no encontrada o sin acceso.',404);
 return {...company,email,role:member.rows[0].role};
}
export async function issueDeviceSession(company){
 if(company.operator)throw new RequestError('Los empleados deben iniciar sesión con su cuenta personal.');
 const token=`mt_${randomBytes(32).toString('base64url')}`;
 const {rows}=await pool.query('INSERT INTO meeter.device_sessions(token_hash,company_id,email) VALUES($1,$2,$3) RETURNING expires_at AS "expiresAt"',[hash(token),company.id,company.email]);
 return {token,expiresAt:rows[0].expiresAt};
}
export async function revokeDeviceSession(req){
 const token=req.headers.authorization?.slice(7);
 if(token)await pool.query('DELETE FROM meeter.device_sessions WHERE token_hash=$1',[hash(token)]);
}
