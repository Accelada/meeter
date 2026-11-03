import http from 'node:http';
import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {existsSync} from 'node:fs';
import {api} from '../server/api.mjs';
import {pool} from '../server/database.mjs';
import {config,allowedHost,requireAccess} from '../server/access.mjs';
import {manifest} from '../server/manifest.mjs';
import {companies} from '../server/companies.mjs';
import {authProxy} from '../server/auth-proxy.mjs';
import {multiTenant} from '../server/company-auth.mjs';
const projectRoot = resolve(fileURLToPath(new URL('../',import.meta.url)));
const root = existsSync(resolve(projectRoot,'dist/taskpane.html')) ? resolve(projectRoot,'dist') : projectRoot;
const demo = process.argv.includes('--demo');
const port = demo ? 3001 : config.port;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.xml':'application/xml'};
const handler=async(req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');return;}
    // Outlook embeds the document cross-site; API calls still enforce their own origin.
    if(!allowedHost(req)){res.writeHead(403);res.end('Forbidden');return;}
    if(await authProxy(req,res,url))return;
    if(await companies(req,res,url))return;
    if(await api(req,res,url))return;
    const pathname = decodeURIComponent(url.pathname==='/'?(multiTenant()?'/portal.html':'/taskpane.html'):url.pathname.startsWith('/empresas/')?'/portal.html':url.pathname);
    if(pathname==='/manifest.xml'){res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'});res.end(await manifest(config.origin));return;}
    if(pathname==='/taskpane.html' && !multiTenant() && !requireAccess(req,res))return;
    if(config.production && pathname.startsWith('/data/')){res.writeHead(404);res.end('Not found');return;}
    const path=resolve(root,'.'+pathname);
    if (!path.startsWith(root+sep) || !['/src/','/data/','/assets/'].some(prefix=>pathname.startsWith(prefix)) && !['/taskpane.html','/portal.html','/commands.html','/manifest.xml'].includes(pathname)) {res.writeHead(404);res.end('Not found');return;}
    const content=await readFile(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
  } catch {res.writeHead(404);res.end('Not found');}
};
try {
  let server;
  if(demo || config.proxy) server=http.createServer(handler);
  else {
    const {getHttpsServerOptions}=await import('office-addin-dev-certs');
    server=https.createServer(await getHttpsServerOptions(),handler);
  }
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.requestTimeout=30000;
  server.listen(port,config.hostname,()=>console.log(`Meeting Cost: ${demo?'http://localhost:3001':config.origin}/taskpane.html${demo?'?demo=1':''} (puerto ${port})`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
    server.close(()=>{void pool?.end().finally(()=>process.exit(0));if(!pool)process.exit(0);});
  });
} catch(error) {console.error('No se pudo iniciar HTTPS:',error.message,'\nEjecuta npm install y npm run certs.');process.exitCode=1;}
