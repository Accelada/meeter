import {readMeeting,loadProperties,saveProperties,saveDraft} from './outlook.js';
import {readCompanySession} from './company-client.js';
const host=typeof window!=='undefined'?window:globalThis;

function uuid() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// Runs in the FunctionFile, independently of whether the task pane is open.
// ItemSend is a pre-send event, not a delivery receipt.
export async function handleSend(event,{office=host.Office,fetchImpl=host.fetch.bind(host),timeoutMs=25000}={}) {
  const item=office.context.mailbox.item;
  if(item.itemType!=='appointment'){event.completed({allowEvent:true});return;}
  let timer;
  const controller=new AbortController();
  try{
    const work=async()=>{
      const properties=await loadProperties(item);
      let requestId=properties.get('meetingCostEstimateId');
      if(!requestId){requestId=uuid();properties.set('meetingCostEstimateId',requestId);await saveProperties(properties);}
      const outlookItemId=item.itemId || await saveDraft(item);
      const meeting=await readMeeting(item);
      meeting.outlookItemId=outlookItemId || undefined;
      if(controller.signal.aborted)throw new Error('Tiempo de espera agotado.');
      const session=readCompanySession(office);
      if(session && (!/^[a-z0-9-]+$/.test(session.slug) || !session.token || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt)<=Date.now()))throw new Error('Sesión caducada.');
      if(session && properties.get('meeterCompanySlug') && properties.get('meeterCompanySlug')!==session.slug)throw new Error('Abre el panel y confirma la empresa de esta convocatoria.');
      const response=await fetchImpl(session?`/api/companies/${session.slug}/estimates`:'./api/estimates',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.token}`}:{})},
        body:JSON.stringify({meeting,source:'outlook',requestId,costCenterId:properties.get('meetingCostCenter') || null})});
      if(!response.ok)throw new Error('No se pudo registrar la estimación.');
      const saved=await response.json();
      if(!saved.id)throw new Error('Respuesta de guardado inválida.');
    };
    await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Tiempo de espera agotado.'));},timeoutMs);})]);
    event.completed({allowEvent:true});
  }catch{
    try{item.notificationMessages.addAsync('MeetingCostSaveError',{type:'errorMessage',message:'No se ha podido guardar el coste de la reunión. Abre el panel, comprueba el acceso al servicio y vuelve a enviar.'},()=>{});}catch{/* Complete even if the notification API is unavailable. */}
    event.completed({allowEvent:false});
  }finally{clearTimeout(timer);controller.abort();}
}

if(typeof window!=='undefined'){
  window.meetingCostOnSend=event=>{void handleSend(event);};
  window.Office.initialize=()=>{};
}
