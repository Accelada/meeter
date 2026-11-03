# Meeter: empresas y acceso independiente

## Modelo

Un servicio y un manifest comunes. Cada empresa tiene su dirección
`https://DOMINIO/empresas/IDENTIFICADOR`. La dirección identifica el espacio;
no es una credencial ni una conexión PostgreSQL. No se admiten endpoints de otros
servidores en el panel: así no se envían credenciales a una URL arbitraria.

Las tablas relacionales del esquema `meeter` utilizan `company_id`. Las consultas
de negocio se ejecutan en transacciones con `SET LOCAL ROLE meeter_tenant` y
contexto de empresa, usuario y perfil. El rol no es dueño de las tablas ni puede
saltarse RLS. Las variables se descartan al terminar la transacción, también con
el pool de Neon. La conexión privilegiada se limita a aprovisionamiento y permisos.

La migración 003 conserva las tablas originales de `meeting_cost`, copia sus datos
a la empresa Demo y no los copia a ninguna empresa nueva. Las nuevas empresas
tienen configuración EUR / tarifa general 0, sin empleados, centros ni reuniones.
Hay que cargar al menos un centro para poder calcular y registrar estimaciones.
Después del cambio de modo, las tablas antiguas son una instantánea; no se mantienen
sincronizadas y volver al modo antiguo no recupera los registros nuevos.

## Activación en Render

1. Desplegar el código actualizado con `npm ci --include=dev && npm run build` y
   `npm start` (o reconstruir la imagen Docker).
2. Aplicar `npm run db:migrate` con `DATABASE_URL_UNPOOLED` de producción, tras probar
   la migración en una rama temporal. No ejecutar las pruebas de integración contra
   producción: los scripts exigen la rama temporal explícita.
3. Activar Neon Auth en la misma rama, registrar `https://meeter.adriancelada.com`
   como dominio de confianza y obtener `NEON_AUTH_BASE_URL` desde Neon. La URL de
   Auth incluye `/neondb/auth`; no es `DATABASE_URL` ni `PUBLIC_BASE_URL`.
4. Configurar en Render:

   ```dotenv
   MEETER_MULTI_TENANT=true
   NEON_AUTH_BASE_URL=URL_DE_AUTH_DE_PRODUCCION
   PUBLIC_BASE_URL=https://meeter.adriancelada.com
   MICROSOFT_LOGIN_ENABLED=false
   ```

   En este proyecto, la URL de Auth de producción es:
   `https://ep-spring-dew-bdfvci4y.neonauth.c-8.us-east-2.aws.neon.tech/neondb/auth`.
   Es configuración pública del proveedor, no una contraseña. No usar la URL de
   la rama temporal en Render.

   Mantener las variables PostgreSQL, HTTPS y `SERVICE_API_KEY` existentes.
   Antes del corte, detener las escrituras del modo antiguo y ejecutar
   `npm run db:sync-demo` si se han registrado reuniones o editado tarifas desde
   la migración 003. Actualiza solo Demo y rechaza ejecutarse si Demo ya tiene
   miembros, para no sobrescribir una empresa que ya está en uso.
   La clave compartida queda reservada al administrador del servicio: no entregarla
   a empleados. La API antigua sin empresa devuelve 404 en modo multiempresa,
   incluso si se presenta esa clave.
5. En Neon Auth habilitar email/password, verificación OTP y el plugin Email OTP.
   Configurar SMTP propio para producción y recuperación de contraseña; probar la
   entrega con una cuenta autorizada. Meeter exige `emailVerified=true` para
   conceder acceso aunque el proveedor permita iniciar sesión sin verificar.
6. Abrir `/portal.html` o `/` y utilizar «Administrador del servicio» con la clave
   actual para crear empresas y habilitar el correo de su primer administrador.
7. El administrador de empresa crea su cuenta, verifica su correo e inicia sesión.
   No necesita ni recibe la clave global. Puede administrar solo las empresas en
   las que tiene acceso; únicamente el operador global puede crear empresas.

El portal es una página pública de acceso. Todos los datos están protegidos por
API. El proxy `/auth/` mantiene las cookies del proveedor en el origen de Meeter;
no depende de cookies de terceros para email/password. Microsoft OAuth lo gestiona
el SDK de Neon y requiere configuración adicional y validación en Office real.

## Configurar una empresa

- Ajustar moneda, tarifa general y correos excluidos.
- Importar empleados como CSV o lista JSON. Columnas: `email`, `name`, `position`,
  `cost` (también acepta `hourlyRate`), `currency`, `active` (`true`/`false`). La moneda
  de todas las tarifas debe coincidir con la de la empresa.
- Importar centros con `id`, `name`.
- Previsualizar: valida filas, tarifas y duplicados y muestra las primeras 20 filas.
  La confirmación vuelve a validar el contenido en el servidor.
- Elegir agregar/actualizar por correo o ID, o reemplazar toda la lista. El reemplazo
  pide confirmación y se ejecuta de forma atómica. Máximo 5000 filas / 2 MB por petición.
- Eliminar registros desde el formulario de eliminación, o modificar con una
  importación de una sola fila. No se cambian las estimaciones históricas.
- Dar acceso a cada correo en «Accesos». El catálogo de tarifas no concede acceso
  por sí solo; permite incluir invitados externos sin autorizarles el servicio.
- Desactivar miembros o revocar sus sesiones. Cambiar una tarifa no cambia permisos.

Ejemplo empleados:

```csv
email,name,position,cost,currency,active
ana@empresa.com,Ana,Ingeniera,55,EUR,true
luis@empresa.com,Luis,Responsable,75,EUR,true
```

Ejemplo centros:

```json
[{"id":"CC-001","name":"Producto"},{"id":"CC-002","name":"Operaciones"}]
```

## Complemento

En el primer uso, introducir la dirección de empresa y las credenciales personales.
Meeter valida la identidad y la pertenencia, y emite una credencial revocable de
30 días. Solo su hash se almacena en PostgreSQL. En Outlook se guarda con
`Office.context.roamingSettings`, nunca en propiedades de la convocatoria ni en el
manifest. Se conserva además una caché local separada por correo del buzón para
recuperarse de snapshots antiguos de Office tras una recarga. La primera conexión
continúa sin recargar el panel. En modo navegador de demostración se guarda en localStorage.

El evento ItemSend lee esa credencial y llama al endpoint de esa empresa sin
abrir ventanas de acceso durante el envío. Si falta, caduca o se revoca, el envío
se bloquea con aviso para abrir el panel y reconectar. Cerrar sesión o cambiar de
empresa revoca la credencial anterior. Cerrar la sesión del portal solo termina
la sesión web: no revoca automáticamente otros dispositivos. Para eso existe
«Revocar sesiones» en el portal administrativo.

Los empleados ven únicamente reuniones registradas con su identidad; los
administradores de empresa ven las de su empresa. `organizerEmail` es metadato de
Outlook, no el dato que decide permisos. Los UUID y EWS IDs de otras empresas no
conceden acceso. Se mantiene el cálculo por reunión y serie y el guardado previo
al envío; no se afirma que Microsoft haya entregado la convocatoria.

## Microsoft

Registrar una aplicación Entra y configurar el proveedor Microsoft en Neon Auth:
Client ID, secreto y redirect URI `NEON_AUTH_BASE_URL/callback/microsoft`.
Configurar `xms_edov` y `acct` como claims opcionales del ID token para que Neon
pueda reconocer el correo como verificado. Elegir los tenants admitidos según los
clientes del servicio. El administrador debe seguir habilitando los correos en
cada empresa; iniciar sesión con Microsoft no otorga acceso automáticamente.
Activar `MICROSOFT_LOGIN_ENABLED=true` solo después de configurar el proveedor.

No se pueden generar Client ID/secret ni conceder consentimiento de una
organización sin acceso a su Entra. El flujo de Microsoft, el correo de verificación
y el runtime real de ItemSend requieren validación en los clientes de destino.
Se mantienen los requisitos de Mailbox 1.8; alojar el servicio no amplía las APIs
disponibles en Outlook 2019. El plan gratuito de Render puede introducir arranques
lentos que excedan el tiempo de espera del evento de envío.

## API multiempresa

[Contrato OpenAPI 3.1 multiempresa](./openapi-companies.json), generado al compilar.

Prefijo: `/api/companies/{slug}`. Autenticación: `Authorization: Bearer JWT_NEON`
con correo verificado, o credencial `mt_...` de usuario. El perfil se consulta en
PostgreSQL en cada petición. El JWT se verifica por firma EdDSA, emisor y caducidad.

| Método y ruta | Uso |
|---|---|
| GET `/api/config` | Capacidades públicas sin secretos |
| GET `/api/companies` | Empresas autorizadas para la identidad; operador ve todas |
| POST `/api/companies` | Crear empresa: `{slug,name}`; operador global |
| GET `{prefijo}` | Empresa, correo y perfil actuales |
| POST `{prefijo}/session` | Crear sesión de dispositivo; requiere JWT personal |
| DELETE `/api/session` | Revocar la credencial presentada |
| GET `{prefijo}/rates` | Catálogo de la empresa |
| POST `{prefijo}/estimates` | Guardado; mismo cuerpo que la API anterior |
| GET `{prefijo}/estimates` | Últimas 20 estimaciones permitidas |
| GET `{prefijo}/v1/meetings?id=...&attribute=durationMinutes` | Reunión o atributo autorizado |
| POST `{prefijo}/v1/meetings/query` | `{id}` o `{ids:[...]}`; hasta 100 |
| GET `{prefijo}/admin/catalog` | Datos editables del catálogo; administrador |
| POST `{prefijo}/admin/settings` | `{currency,defaultHourlyRate,excludedEmails}` |
| POST `{prefijo}/admin/import` | `{kind,format,content,mode,apply}`; `apply:false` para previsualizar |
| GET/POST `{prefijo}/admin/members` | Listar / actualizar `{email,role,active}` |
| DELETE `{prefijo}/admin/employee` | `{email}` |
| DELETE `{prefijo}/admin/center` | `{id}` |
| DELETE `{prefijo}/admin/sessions` | Revocar dispositivos de `{email}` |

`kind`: `employees` o `centers`; `format`: `csv` o `json`; `mode`: `merge` o
`replace`; `role`: `admin` o `employee`. Los cuerpos son JSON. Respuestas de error:
400 validación, 401 sesión/identidad, 403 perfil insuficiente, 404 recurso oculto o
inexistente, 409 identificador duplicado, 413 tamaño, 503 indisponibilidad.

## Pruebas

`npm test` y `npm run build`. Los scripts `npm run test:tenants` y
`npm run test:auth` requieren explícitamente la rama temporal y sus variables.
Prueban PostgreSQL real, RLS, HTTP, importaciones, registros, revocación y Neon Auth
real. En la rama de pruebas el correo está desactivado; se verifica una identidad
ficticia directamente en la rama para probar el JWT, sin enviar mensajes.
