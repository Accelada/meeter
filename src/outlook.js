export function getAsync(property) {
  return new Promise((resolve,reject)=>{
    if(!property?.getAsync){reject(new Error('API de Outlook no disponible.'));return;}
    property.getAsync(response=>response.status==='succeeded'?resolve(response.value):reject(new Error(response.error?.message || 'No se pudo leer la convocatoria.')));
  });
}
export function loadProperties(item) {
  return new Promise((resolve,reject)=>item.loadCustomPropertiesAsync(response=>response.status==='succeeded'?resolve(response.value):reject(new Error('No se pudieron leer las propiedades de la convocatoria.'))));
}
export function saveProperties(properties) {
  return new Promise((resolve,reject)=>properties.saveAsync(response=>response.status==='succeeded'?resolve():reject(new Error('No se pudo guardar el centro de coste en la convocatoria.'))));
}
export function saveDraft(item) {
  return new Promise((resolve,reject)=>item.saveAsync(response=>response.status==='succeeded'?resolve(response.value):reject(new Error('No se pudieron conservar los datos de la convocatoria.'))));
}
export async function readMeeting(item) {
  const [required,optional,start,end,organizer,subject,rawRecurrence]=await Promise.all([
    getAsync(item.requiredAttendees),getAsync(item.optionalAttendees),getAsync(item.start),getAsync(item.end),getAsync(item.organizer),getAsync(item.subject),
    item.recurrence?.getAsync?getAsync(item.recurrence):Promise.resolve({unavailable:true})
  ]);
  const attendee=p=>({email:p.emailAddress,name:p.displayName,isResource:String(p.recipientType).toLowerCase()==='resource'});
  const recurrence=rawRecurrence?.unavailable?rawRecurrence:fromOfficeRecurrence(rawRecurrence);
  const seriesDuration=rawRecurrence?.seriesTime?.getDuration?.();
  return {subject,recurrence,organizerEmail:organizer.emailAddress,outlookItemId:item.itemId || undefined,durationMinutes:seriesDuration ?? (new Date(end)-new Date(start))/60000,start:new Date(start).toISOString(),end:new Date(end).toISOString(),
    attendees:[attendee(organizer),...required.map(attendee),...optional.map(attendee)]};
}
import {fromOfficeRecurrence} from './recurrence.js';
