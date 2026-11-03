const key='meeter.company.session';
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}
function cacheKey(office){
 if(!office?.context?.mailbox)return key;
 const email=office.context.mailbox.userProfile?.emailAddress?.trim().toLowerCase();
 return email?`${key}:${email}`:null;
}
export function companyEndpoint(input){
 let url;try{url=new URL(input.trim());}catch{throw new Error('Introduce una dirección completa de empresa, por ejemplo '+location.origin+'/empresas/mi-empresa');}
 if(url.origin!==location.origin || url.search || url.hash || !/^\/empresas\/[a-z0-9][a-z0-9-]{1,62}\/?$/.test(url.pathname))throw new Error('Introduce la dirección de empresa de este servicio, por ejemplo '+location.origin+'/empresas/mi-empresa');
 return url.pathname.split('/')[2];
}
export function readCompanySession(office=globalThis.Office,storage=browserStorage()){
 let roaming=null,cached=null;
 try{roaming=office?.context?.roamingSettings?.get(key);}catch{/* The per-mailbox cache can still be available. */}
 const localKey=cacheKey(office);
 try{if(localKey)cached=JSON.parse(storage?.getItem(localKey) || 'null');}catch{/* Office storage restrictions must not break roaming settings. */}
 if(roaming && cached)return (cached.savedAt || 0)>(roaming.savedAt || 0)?cached:roaming;
 return roaming || cached || null;
}
export async function storeCompanySession(session,office=globalThis.Office,storage=browserStorage()){
 const saved={...session,savedAt:Date.now()};
 if(office?.context?.roamingSettings){
  const settings=office.context.roamingSettings,previous=settings.get(key);settings.set(key,saved);
  try{await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Outlook no ha confirmado el guardado. Vuelve a intentarlo.')),12000);
   settings.saveAsync(r=>{clearTimeout(timeout);if(r.status==='succeeded')resolve();else reject(new Error('No se pudo recordar la empresa en Outlook.'));});
  });}
  catch(error){if(previous)settings.set(key,previous);else settings.remove?.(key);throw error;}
 }
 const localKey=cacheKey(office);
 try{if(localKey && storage)storage.setItem(localKey,JSON.stringify(saved));else if(!office?.context?.roamingSettings)throw new Error();}
 catch{if(!office?.context?.roamingSettings)throw new Error('El navegador no permite guardar la conexión. Revisa los permisos de almacenamiento.');}
 return saved;
}
export async function clearCompanySession(office=globalThis.Office){
 const session=readCompanySession(office);
 if(session?.token)await fetch('/api/session',{method:'DELETE',headers:{Authorization:`Bearer ${session.token}`}}).catch(()=>{});
 if(office?.context?.roamingSettings){const settings=office.context.roamingSettings;settings.remove(key);await new Promise(resolve=>settings.saveAsync(resolve));}
 try{const localKey=cacheKey(office);if(localKey)browserStorage()?.removeItem(localKey);}catch{/* Roaming credentials have already been removed. */}
}
export function companyRequest(path,options={},session=readCompanySession()){
 if(!session?.slug || !/^[a-z0-9-]+$/.test(session.slug) || !session.token || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt)<=Date.now())throw new Error('Abre el panel y vuelve a iniciar sesión en tu empresa.');
 return fetch(`/api/companies/${session.slug}${path}`,{...options,headers:{...options.headers,Authorization:`Bearer ${session.token}`}});
}
