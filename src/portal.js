import {authClient,identityToken} from './identity.bundle.js';
import {signupValues,authError} from './portal-validation.js';
const $=id=>document.getElementById(id);let operator='',slug='',companies=[],previewInput=null;
const status=(text,kind='info')=>{$('status').textContent=text;$('status').dataset.kind=kind;};
async function run(action){try{status('Procesando…');await action();if($('status').textContent==='Procesando…')status('Cambios completados.','success');}catch(e){status(authError(e),'error');$('status').focus();}}
function checkAuth(result){if(result.error)throw new Error(authError(result.error));return result.data;}
function table(target,columns,rows,empty='No hay registros todavía.'){
 target.replaceChildren();if(!rows.length){const p=document.createElement('p');p.textContent=empty;target.append(p);return;}
 const wrap=document.createElement('div');wrap.className='table-wrap';const t=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
 for(const [label] of columns){const th=document.createElement('th');th.scope='col';th.textContent=label;tr.append(th);}head.append(tr);t.append(head);const body=document.createElement('tbody');
 for(const row of rows){const tr=document.createElement('tr');for(const [,value] of columns){const td=document.createElement('td');td.textContent=String(value(row) ?? '—');tr.append(td);}body.append(tr);}t.append(body);wrap.append(t);target.append(wrap);
}
function heading(target,text){const h=document.createElement('h3');h.textContent=text;target.append(h);const box=document.createElement('div');target.append(box);return box;}
function showCatalog(catalog){
 const container=$('catalog');container.replaceChildren();
 const money=value=>new Intl.NumberFormat('es-ES',{style:'currency',currency:catalog.settings.currency}).format(value);
 table(heading(container,'Empleados y tarifas'),[['Nombre',r=>r.name],['Correo',r=>r.email],['Cargo',r=>r.position],['Tarifa / hora',r=>money(r.cost)],['Estado',r=>r.active?'Activo':'Inactivo']],catalog.employees);
 table(heading(container,'Centros de coste'),[['Identificador',r=>r.id],['Nombre',r=>r.name]],catalog.centers);
}
function importHelp(){$('importHelp').textContent=$('importKind').value==='employees'?'Columnas: email, name, position, cost, currency, active. Ejemplo: ana@empresa.com, Ana, Ingeniera, 55, EUR, true.':'Columnas: id, name. Ejemplo: CC-001, Producto.';}
async function request(path,options={}){
 const authorization=operator?`Basic ${btoa('meeting-cost:'+operator)}`:`Bearer ${await identityToken()}`;
 const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',Authorization:authorization,...options.headers}});
 const value=await response.json();if(!response.ok)throw new Error(value.error || 'Error de acceso.');return value;
}
const post=(path,value)=>request(path,{method:'POST',body:JSON.stringify(value)});
const prefix=()=>`/companies/${slug}`;
async function selectCompany(){
 slug=$('company').value;$('companySpace').hidden=!slug;if(!slug)return;
 const company=await request(prefix());$('endpoint').textContent=location.origin+'/empresas/'+slug;$('accessRole').textContent=`${company.name} · ${company.role==='admin'?'Administrador':'Empleado'}`;
 $('adminSpace').hidden=company.role!=='admin';$('meetings').textContent='';previewInput=null;$('applyImport').disabled=true;
 if(company.role==='admin'){
  const [catalog,members]=await Promise.all([request(prefix()+'/admin/catalog'),request(prefix()+'/admin/members')]);
  showCatalog(catalog);table($('members'),[['Correo',r=>r.email],['Perfil',r=>r.role==='admin'?'Administrador':'Empleado'],['Acceso',r=>r.active?'Permitido':'Desactivado']],members,'Todavía no has habilitado ninguna cuenta.');
  $('currency').value=catalog.settings.currency;$('defaultRate').value=catalog.settings.defaultHourlyRate;$('excluded').value=catalog.excludedEmails.join('\n');
 }
}
async function openWorkspace(){
 companies=await request('/companies');$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('createCompanyBlock').hidden=!operator;
 const selected=slug || location.pathname.match(/^\/empresas\/([a-z0-9-]+)/)?.[1];$('company').replaceChildren();
 for(const c of companies){const o=document.createElement('option');o.value=c.slug;o.textContent=c.name;$('company').append(o);}
 if(companies.some(c=>c.slug===selected))$('company').value=selected;
 await selectCompany();if(!companies.length)status('Todavía no tienes acceso a ninguna empresa. Pide al administrador que habilite tu correo.');
}
function bindForm(id,action){$(id).addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;if(button?.disabled)return;if(button)button.disabled=true;try{await run(action);}finally{if(button)button.disabled=false;}});}
bindForm('loginForm',async()=>{checkAuth(await authClient.signIn.email({email:$('email').value.trim().toLowerCase(),password:$('password').value}));$('password').value='';await openWorkspace();});
bindForm('operatorForm',async()=>{operator=$('operatorKey').value;$('operatorKey').value='';try{await openWorkspace();}catch(e){operator='';throw e;}});
bindForm('signupForm',async()=>{
 const input=signupValues({name:$('signupName').value,email:$('signupEmail').value,password:$('signupPassword').value,confirm:$('signupConfirm').value});
 checkAuth(await authClient.signUp.email(input));$('signupPassword').value='';$('signupConfirm').value='';$('email').value=input.email;$('verifyEmail').value=input.email;$('confirmEmailAddress').value=input.email;
 $('signupBlock').open=false;$('verificationBlock').open=true;status('Cuenta creada. Pulsa «Enviar código» para verificar tu correo. Después podrás entrar cuando tu empresa haya habilitado tu acceso.','success');$('verificationBlock').scrollIntoView({block:'start',behavior:'smooth'});
});
bindForm('verifyForm',async()=>{const email=$('verifyEmail').value.trim().toLowerCase();checkAuth(await authClient.emailOtp.sendVerificationOtp({email,type:'email-verification'}));$('confirmEmailAddress').value=email;status('Código solicitado. Revisa tu correo e introdúcelo en «Confirmar correo».','success');$('otp').focus();});
bindForm('confirmForm',async()=>{const email=$('confirmEmailAddress').value.trim().toLowerCase();checkAuth(await authClient.emailOtp.verifyEmail({email,otp:$('otp').value.trim()}));$('email').value=email;$('otp').value='';status('Correo verificado. Ya puedes iniciar sesión.','success');});
bindForm('recoveryForm',async()=>{checkAuth(await authClient.requestPasswordReset({email:$('recoveryEmail').value.trim().toLowerCase(),redirectTo:location.origin+'/portal.html'}));status('Si la cuenta existe, recibirás instrucciones para recuperar el acceso.','success');});
bindForm('resetForm',async()=>{checkAuth(await authClient.resetPassword({newPassword:$('newPassword').value,token:new URLSearchParams(location.search).get('token')}));location.href='/portal.html';});
$('microsoft').onclick=()=>run(async()=>{const r=await authClient.signIn.social({provider:'microsoft',callbackURL:location.href});if(r.error)throw new Error(r.error.message);});
$('logout').onclick=()=>run(async()=>{operator='';await authClient.signOut();location.href='/portal.html';});
$('company').onchange=()=>run(selectCompany);
bindForm('createCompany',async()=>{const c=await post('/companies',{name:$('companyName').value,slug:$('companySlug').value});slug=c.slug;await openWorkspace();});
bindForm('settingsForm',async()=>{await post(prefix()+'/admin/settings',{currency:$('currency').value.toUpperCase(),defaultHourlyRate:Number($('defaultRate').value),excludedEmails:$('excluded').value.split(/\n/).map(s=>s.trim()).filter(Boolean)});await selectCompany();});
$('importFile').onchange=()=>run(async()=>{const file=$('importFile').files[0];if(file){if(file.size>1500000)throw new Error('Máximo 1,5 MB por archivo.');$('importText').value=await file.text();previewInput=null;$('applyImport').disabled=true;}});
for(const id of ['importText','importKind','importMode'])$(id).oninput=()=>{previewInput=null;$('applyImport').disabled=true;if(id==='importKind')importHelp();};
$('preview').onclick=()=>run(async()=>{
 const content=$('importText').value;const input={kind:$('importKind').value,format:content.trim().startsWith('[')?'json':'csv',content,mode:$('importMode').value};
 const result=await post(prefix()+'/admin/import',input);$('previewResult').replaceChildren();const p=document.createElement('p');p.textContent=result.valid?`${result.rows.length} registros válidos. Se muestran los primeros 20. Confirma para guardarlos.`:result.errors.join('\n');$('previewResult').append(p);
 const preview=document.createElement('div');$('previewResult').append(preview);
 table(preview,result.kind==='employees'?[['Correo',r=>r.email],['Nombre',r=>r.name],['Tarifa / hora',r=>`${r.cost} ${r.currency}`]]:[['ID',r=>r.id],['Nombre',r=>r.name]],result.rows.slice(0,20));previewInput=result.valid?input:null;$('applyImport').disabled=!result.valid;if(!result.valid)status('Corrige los errores de la previsualización antes de confirmar.','error');
});
$('applyImport').onclick=()=>run(async()=>{if(!previewInput)throw new Error('Previsualiza la importación.');if(previewInput.mode==='replace' && !confirm('Se reemplazará toda esta lista de la empresa. ¿Continuar?'))return;await post(prefix()+'/admin/import',{...previewInput,apply:true});await selectCompany();});
bindForm('memberForm',async()=>{await post(prefix()+'/admin/members',{email:$('memberEmail').value,role:$('memberRole').value,active:$('memberActive').checked});await selectCompany();});
bindForm('deleteForm',async()=>{if(!confirm('¿Eliminar este registro de la empresa?'))return;await request(prefix()+'/admin/'+$('deleteKind').value,{method:'DELETE',body:JSON.stringify({email:$('deleteId').value,id:$('deleteId').value})});await selectCompany();});
bindForm('revokeForm',async()=>{await request(prefix()+'/admin/sessions',{method:'DELETE',body:JSON.stringify({email:$('revokeEmail').value})});});
$('loadMeetings').onclick=()=>run(async()=>{const rows=await request(prefix()+'/estimates');table($('meetings'),[['Reunión',r=>r.report.subject],['Fecha de registro',r=>new Date(r.createdAt).toLocaleString('es-ES')],['Minutos',r=>r.report.durationMinutes],['Coste / reunión',r=>`${r.report.total} ${r.report.currency}`],['ID',r=>r.id]],rows,'No hay estimaciones registradas a las que puedas acceder.');});
$('copyEndpoint').onclick=()=>run(async()=>{await navigator.clipboard.writeText($('endpoint').textContent);status('Dirección copiada. Pégala en la configuración del complemento.','success');});
importHelp();
void run(async()=>{
 const config=await (await fetch('/api/config')).json();if(!config.multiTenant)throw new Error('Activa MEETER_MULTI_TENANT y ejecuta las migraciones para utilizar el portal.');
 $('microsoft').hidden=!config.microsoftEnabled;
 if(new URLSearchParams(location.search).has('token')){$('login').hidden=true;$('resetView').hidden=false;return;}
 try{const {data}=await authClient.getSession();if(data?.user)await openWorkspace();else status('');}catch{status('Inicia sesión para continuar.');}
});
