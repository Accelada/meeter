import {allowedOrigin,config} from './access.mjs';
import {json} from './companies.mjs';
// Same-origin cookies avoid depending on third-party cookies inside Outlook.
export async function authProxy(req,res,url){
 if(!url.pathname.startsWith('/auth/'))return false;
 if(!process.env.NEON_AUTH_BASE_URL){json(res,503,{error:'Autenticación sin configurar.'});return true;}
 if(!allowedOrigin(req)){json(res,403,{error:'Origen no permitido.'});return true;}
 try{
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536){json(res,413,{error:'Solicitud demasiado grande.'});return true;}}
  const target=new URL(process.env.NEON_AUTH_BASE_URL.replace(/\/$/,'')+url.pathname.slice(5)+url.search);
  const headers={'Origin':config.origin};
  for(const name of ['content-type','cookie','authorization','neon-auth-session-verifier'])if(req.headers[name])headers[name]=req.headers[name];
  const upstream=await fetch(target,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body,redirect:'manual',signal:AbortSignal.timeout(15000)});
  const responseHeaders={'Content-Type':upstream.headers.get('content-type') || 'application/json','Cache-Control':'no-store'};
  const cookies=upstream.headers.getSetCookie().map(c=>c.replace(/;\s*Domain=[^;]+/ig,''));
  if(cookies.length)responseHeaders['Set-Cookie']=cookies;
  for(const name of ['location','set-auth-jwt','neon-auth-session-verifier'])if(upstream.headers.has(name))responseHeaders[name]=upstream.headers.get(name);
  res.writeHead(upstream.status,responseHeaders);res.end(Buffer.from(await upstream.arrayBuffer()));
 }catch{json(res,503,{error:'No se pudo conectar con el servicio de identidad.'});}
 return true;
}
