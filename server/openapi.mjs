import {readFile} from 'node:fs/promises';
export async function openApi(tenant=false){
 const spec=JSON.parse(await readFile(new URL('../docs/openapi.json',import.meta.url),'utf8'));
 if(!tenant)return spec;
 spec.info.version='2.0.0';spec.info.description='Espacios por empresa. JWT Neon verificado o sesión personal mt_. Las reuniones se filtran por empresa y propietario. La clave global solo permite administrar el servicio.';
 const original=spec.paths;spec.paths={};spec.security=[{bearerAuth:[]}];
 const slug={name:'slug',in:'path',required:true,schema:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{1,62}$'}};
 for(const [path,item] of Object.entries(original))spec.paths[path.replace('/api','/api/companies/{slug}')]={...item,parameters:[slug,...(item.parameters || [])]};
 function operation(summary,properties,required=[],status='200'){
  return {summary,responses:{[status]:{description:'Operación completada'},'400':{description:'Entrada inválida'},'401':{description:'Identidad o sesión requerida'},'403':{description:'Perfil insuficiente'},'404':{description:'Recurso inexistente o sin acceso'},'503':{description:'Servicio no disponible'}},...(properties?{requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties,required}}}}}:{})};
 }
 const text={type:'string'},email={type:'string',format:'email'};
 spec.paths['/api/config']={get:{...operation('Configuración pública de acceso'),security:[]}};
 spec.paths['/api/companies']={get:operation('Empresas autorizadas'),post:{...operation('Crear empresa vacía; solo operador global',{slug:text,name:text},['slug','name'],'201'),security:[{basicAuth:[]},{bearerAuth:[]}]}};
 const base='/api/companies/{slug}';
 const add=(path,method,op)=>{spec.paths[base+path] ||= {parameters:[slug]};spec.paths[base+path][method]=op;};
 add('','get',operation('Empresa, perfil y correo actuales'));
 add('/session','post',operation('Emitir sesión de dispositivo por 30 días; requiere JWT personal',null,[],'201'));
 spec.paths['/api/session']={delete:operation('Revocar la sesión de dispositivo presentada')};
 add('/estimates','get',operation('Últimas 20 estimaciones autorizadas'));
 add('/estimates','post',operation('Guardar estimación de la empresa con propietario autenticado',{meeting:{type:'object',properties:{subject:text,durationMinutes:{type:'number',exclusiveMinimum:0},attendees:{type:'array',items:{type:'object',properties:{email},required:['email']}},recurrence:{type:['object','null']}},required:['subject','durationMinutes','attendees']},source:{enum:['demo','outlook']},requestId:{type:'string',format:'uuid'},costCenterId:{type:['string','null']}},['meeting','source','costCenterId'],'201'));
 add('/admin/catalog','get',operation('Catálogo completo editable; administrador'));
 add('/admin/settings','post',operation('Actualizar configuración; administrador',{currency:{type:'string',pattern:'^[A-Z]{3}$'},defaultHourlyRate:{type:'number',minimum:0},excludedEmails:{type:'array',items:email}},['currency','defaultHourlyRate','excludedEmails']));
 add('/admin/import','post',operation('Previsualizar o confirmar importación atómica; administrador',{kind:{enum:['employees','centers']},format:{enum:['csv','json']},content:text,mode:{enum:['merge','replace']},apply:{type:'boolean',default:false}},['kind','format','content']));
 add('/admin/members','get',operation('Listar accesos; administrador'));
 add('/admin/members','post',operation('Habilitar, cambiar perfil o desactivar miembro',{email,role:{enum:['admin','employee']},active:{type:'boolean'}},['email','role','active']));
 add('/admin/employee','delete',operation('Eliminar empleado del catálogo',{email},['email']));
 add('/admin/center','delete',operation('Eliminar centro de coste',{id:text},['id']));
 add('/admin/sessions','delete',operation('Revocar dispositivos del miembro',{email},['email']));
 return spec;
}
