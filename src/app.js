import {calculate,validateRates} from './calculator.js';
import {readMeeting,loadProperties,saveProperties,saveDraft} from './outlook.js';
import {readCompanySession,storeCompanySession,clearCompanySession,companyEndpoint,companyRequest} from './company-client.js';
import {authError} from './portal-validation.js';
const $=id=>document.getElementById(id);
const demo=new URLSearchParams(location.search).get('demo')==='1';
let config,meeting,result,officeItem,timer,busy=false,queued=false;
let tenantMode=false,activeSession=null;
async function connectCompany(){
 const {authClient,identityToken}=await import('./identity.bundle.js');
 const slug=companyEndpoint($('companyEndpoint').value);
 $('status').textContent='Comprobando tu cuenta y el acceso a la empresa…';
 const login=await authClient.signIn.email({email:$('companyEmail').value.trim().toLowerCase(),password:$('companyPassword').value});
 if(login.error)throw new Error(authError(login.error));
 const response=await fetch(`/api/companies/${slug}/session`,{method:'POST',headers:{Authorization:`Bearer ${await identityToken()}`},signal:AbortSignal.timeout(25000)});
 const session=await response.json();if(!response.ok)throw new Error(session.error);
 $('status').textContent='Guardando la conexión en Outlook…';
 activeSession=await storeCompanySession({...session,slug});
 $('companyPassword').value='';$('companySetup').hidden=true;
 // A task-pane reload can rehydrate an outdated Office roaming-settings snapshot.
 // Continue using the confirmed session in this runtime instead.
 await init();
}
async function prepareCompany(){
 const response=await fetch('/api/config');if(!response.ok)return true;
 const options=await response.json();tenantMode=options.multiTenant;if(!tenantMode)return true;
 $('costContent').hidden=true;
 if(!demo && !officeItem){await loadOffice();officeItem=Office.context.mailbox.item;}
 const session=activeSession || readCompanySession();
 $('companyDisconnect').onclick=async()=>{await clearCompanySession();activeSession=null;location.reload();};
 if(session?.token && Date.parse(session.expiresAt)>Date.now()){
  const check=await companyRequest('',{},session);if(check.ok){activeSession=session;const company=await check.json();$('companySetup').hidden=true;$('companyAccount').hidden=false;$('companyLabel').textContent=company.name;$('costContent').hidden=false;return true;}
 }
 $('companySetup').hidden=false;$('status').textContent='Introduce la dirección de tu empresa e inicia sesión.';
 $('companyForm').onsubmit=async event=>{event.preventDefault();const button=$('companyLogin');button.disabled=true;button.textContent='Conectando…';$('status').textContent='Conectando con tu empresa…';try{await connectCompany();}catch(e){$('status').textContent=authError(e);$('status').focus();}finally{button.disabled=false;button.textContent='Entrar y conectar';}};
 $('companyMicrosoft').hidden=!options.microsoftEnabled;
 $('companyMicrosoft').onclick=async()=>{
  try{
   const slug=companyEndpoint($('companyEndpoint').value);sessionStorage.setItem('meeter.pendingCompany',slug);
   const {authClient}=await import('./identity.bundle.js');
   const result=await authClient.signIn.social({provider:'microsoft',callbackURL:location.href});if(result.error)throw new Error(result.error.message);
  }catch(e){$('status').textContent=e.message;}
 };
 const pending=sessionStorage.getItem('meeter.pendingCompany');
 if(pending){
  sessionStorage.removeItem('meeter.pendingCompany');
  try{const {identityToken}=await import('./identity.bundle.js');const r=await fetch(`/api/companies/${pending}/session`,{method:'POST',headers:{Authorization:`Bearer ${await identityToken()}`}});const s=await r.json();if(!r.ok)throw new Error(s.error);activeSession=await storeCompanySession({...s,slug:pending});$('companySetup').hidden=true;await init();}catch(e){$('status').textContent=authError(e);}
 }
 return false;
}
const money=value=>new Intl.NumberFormat('es-ES',{style:'currency',currency:config.currency}).format(value);
const num=value=>new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(value);
function invalidate(message){result=null;$('total').textContent='—';$('perMeeting').hidden=true;$('seriesTotal').hidden=true;$('summary').textContent='Sin estimación válida';$('metrics').textContent='';$('people').replaceChildren();$('peopleCount').textContent='';$('export').disabled=true;$('status').textContent=message;}
function render(){
  try{
    result=calculate(meeting,config);
    $('total').textContent=money(result.total);
    $('perMeeting').hidden=result.isRecurring!==true;
    $('seriesTotal').hidden=result.seriesStatus==='single';
    $('seriesTotal').textContent=result.seriesStatus==='finite'?`${money(result.seriesTotal)} en total · ${num(result.occurrenceCount)} reuniones`:
      result.seriesStatus==='unbounded'?'Sin fecha de fin · total de la serie no acotado':
      result.seriesStatus==='unavailable'?'Periodicidad no disponible en este cliente':'Total no disponible para una serie de más de 200 años';
    $('summary').textContent=`${result.personCount} personas · ${num(result.durationMinutes)} minutos`;
    $('metrics').textContent=`${money(result.costPerMinute)}/min · ${num(result.personHours)} horas-persona`;
    $('peopleCount').textContent=result.personCount;
    $('people').replaceChildren();
    for(const person of result.people){
      const row=document.createElement('div');row.className='person';
      const name=document.createElement('span');name.className='person-name';name.textContent=person.email;
      const rate=document.createElement('span');rate.className='person-rate';rate.textContent=`${money(person.hourlyRate)}/h`;
      row.append(name);
      if(person.source==='default'){
        const warning=document.createElement('span');warning.className='rate-warning';warning.tabIndex=0;warning.setAttribute('role','img');
        const message=`Sin tarifa en el catálogo. Se aplica la tarifa general: ${money(config.defaultHourlyRate)}/h.`;
        warning.setAttribute('aria-label',message);warning.title=message;
        warning.innerHTML='<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 3 8 14H2L10 3Z"/><path d="M10 8v4m0 2v.1"/></svg>';
        const tooltip=document.createElement('span');tooltip.className='tooltip';tooltip.textContent=message;tooltip.setAttribute('aria-hidden','true');warning.append(tooltip);row.append(warning);
      }
      row.append(rate);$('people').append(row);
    }
    $('export').disabled=false;
  }catch(error){invalidate(error.message);}
}
async function refresh(){
  if(busy){queued=true;return;}busy=true;
  try{
    if(demo){
      const raw=$('minutes').value;
      meeting={subject:'Reunión de demostración',durationMinutes:raw.trim()?Number(raw):NaN,
        recurrence:$('recurring').checked?{type:$('frequency').value,interval:Number($('interval').value),startDate:$('seriesStart').value,
          ...($('unbounded').checked?{endDate:null}:{numberOfOccurrences:Number($('occurrences').value)})}:null,
        attendees:[{email:$('organizer').value},...$('emails').value.split(/[,;\n]+/).filter(s=>s.trim()).map(email=>({email:email.trim()}))]};
      $('recurrenceControls').hidden=!$('recurring').checked;$('occurrences').disabled=$('unbounded').checked;
      if(meeting.attendees.some(p=>!/^\S+@\S+\.\S+$/.test(p.email.trim())))throw new Error('Revisa los correos de los asistentes.');
    }else meeting=await readMeeting(officeItem);
    render();
    if(result && $('status').dataset.kind==='input'){$('status').textContent='';delete $('status').dataset.kind;}
  }catch(error){invalidate(error.message);$('status').dataset.kind='input';}
  finally{busy=false;if(queued){queued=false;void refresh();}}
}
function loadOffice(){return new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://appsforoffice.microsoft.com/lib/1/hosted/office.js';
  script.onerror=()=>reject(new Error('No se pudo cargar Office.js.'));
  script.onload=()=>Office.onReady(resolve);document.head.append(script);
});}
async function init(){
  try{
    if(!await prepareCompany())return;
    const response=await (tenantMode?companyRequest('/rates',{},activeSession):fetch('./api/rates'));const data=await response.json();
    if(response.ok)config=validateRates(data);
    else if(demo && data.code==='DATABASE_NOT_CONFIGURED'){
      const local=await fetch('./data/rates.json');if(!local.ok)throw new Error('No se pudo cargar el catálogo.');config=validateRates(await local.json());
    }else throw new Error(data.error || 'No se pudo cargar el catálogo PostgreSQL.');
    $('center').replaceChildren();for(const center of config.costCenters){const option=document.createElement('option');option.value=center.id;option.textContent=`${center.id} · ${center.name}`;$('center').append(option);}
    $('export').addEventListener('click',()=>{
      if(!result)return;
      const report={schemaVersion:1,generatedAt:new Date().toISOString(),source:demo?'demo':'outlook',costCenter:config.costCenters.find(c=>c.id===$('center').value),subject:meeting.subject,start:meeting.start,end:meeting.end,recurrence:meeting.recurrence,...result};
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='meeter-estimado.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    $('status').textContent='';
    if(demo){
      $('mode').textContent='Demo';$('demoControls').hidden=false;
      for(const id of ['organizer','emails','minutes','recurring','frequency','interval','seriesStart','occurrences','unbounded'])$(id).addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(refresh,250);});
    }else{
      const info=await Promise.race([officeItem?Promise.resolve({host:Office.HostType.Outlook}):loadOffice(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Abre el complemento desde Outlook o usa ?demo=1.')),12000))]);
      if(info.host!==Office.HostType.Outlook)throw new Error('Abre el complemento desde Outlook.');
      officeItem=Office.context.mailbox.item;
      if(!officeItem?.start?.getAsync)throw new Error('Abre una convocatoria que estés organizando.');
      if(!Office.context.requirements.isSetSupported('Mailbox','1.8'))$('status').textContent='Esta versión de Outlook no admite el guardado automático al enviar. El cálculo y la descarga siguen disponibles.';
      const properties=await loadProperties(officeItem);
      const session=tenantMode?(activeSession || readCompanySession()):null;
      const companyChanged=session && properties.get('meeterCompanySlug')!==session.slug;
      const savedCenter=companyChanged?null:properties.get('meetingCostCenter');
      if(config.costCenters.some(c=>c.id===savedCenter))$('center').value=savedCenter;
      if(session && (companyChanged || !config.costCenters.some(c=>c.id===savedCenter))){
        properties.set('meeterCompanySlug',session.slug);properties.set('meetingCostCenter',$('center').value);await saveProperties(properties);
      }
      $('center').addEventListener('change',async()=>{
        const select=$('center');select.disabled=true;
        try{const current=await loadProperties(officeItem);current.set('meetingCostCenter',select.value);await saveProperties(current);await saveDraft(officeItem);}
        catch(error){$('status').textContent=error.message;}
        finally{select.disabled=false;}
      });
      for(const event of [Office.EventType.RecipientsChanged,Office.EventType.AppointmentTimeChanged,Office.EventType.RecurrenceChanged]){
        if(event && officeItem.addHandlerAsync){try{officeItem.addHandlerAsync(event,()=>void refresh(),()=>{});}catch{/* Polling remains available. */}}
      }
      timer=setInterval(()=>{if(!document.hidden)void refresh();},3000);
      window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
    }
    await refresh();
  }catch(error){invalidate(error.message);}
}
void init();
