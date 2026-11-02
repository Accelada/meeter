# Meeter API · v1

API de una organización. Consulta estimaciones **ya registradas en este servicio**.
No descarga eventos desde Microsoft Graph ni confirma que una invitación se haya entregado:
el registro automático procede del evento previo al envío `ItemSend`.

## Autenticación

En el servidor desplegado configura `SERVICE_API_KEY` (secreto aleatorio de 32 caracteres o más).
Los clientes de servidor utilizan `Authorization: Bearer <SERVICE_API_KEY>`. No incluyas el
secreto en URLs, manifiestos, código del navegador ni repositorios.

El panel utiliza autenticación HTTP Basic sobre HTTPS: usuario `meeting-cost`, contraseña
igual a `SERVICE_API_KEY`. Outlook debe disponer de esas credenciales para las llamadas
del panel y del controlador de envío. Abre el panel para autenticar antes del primer envío.
La disponibilidad de credenciales entre ventanas de Office debe probarse en el cliente real;
si no están disponibles, el controlador no autoriza el envío sin registro confirmado.

Es un acceso compartido de una organización, sin roles ni aislamiento entre usuarios.
Para ofrecerlo a varias organizaciones o identificar usuarios individualmente, debe
añadirse una identidad corporativa y autorización por organización antes de usarlo así.

En desarrollo local sin clave, solo se admite el host localhost/127.0.0.1. Las peticiones
desde navegador deben tener el mismo origen que el servicio. Las integraciones de
servidor pueden omitir Origin si presentan Authorization; no se habilita CORS abierto.

## IDs

- `id`: UUID interno estable de la estimación. Es la forma recomendada de consulta.
- `outlookItemId`: ID EWS que Outlook proporcionó al registrar la convocatoria.
  Se puede consultar por ese valor usando la misma API. En query strings debes codificarlo
  como URL (puede contener `+`, `/` y `=`). No es un ID de Graph ni un iCalUId.
- Las estimaciones antiguas solo tienen UUID si fueron guardadas antes de capturar el ID de Outlook.
- Si un ID de Outlook coincide con varios registros, se devuelve 409 y debe usarse el UUID.
- Reenviar/actualizar una convocatoria conserva el UUID y actualiza su última estimación.

## POST /api/v1/meetings/query

Recupera información registrada por ID o por lista. Cuerpo JSON, máximo 100 IDs y 64 KiB:

```json
{"id":"UUID-o-ID-de-Outlook"}
```

```json
{"ids":["primer-ID","segundo-ID"]}
```

Respuesta 200:

```json
{
  "meetings": [{"id":"UUID", "subject":"Reunión", "durationMinutes":30, "total":122.5, "currency":"EUR"}],
  "missingIds": ["ID-no-registrado"]
}
```

Los registros devueltos incluyen el reporte completo, fecha de creación y atributos
disponibles. Se conserva el orden de los IDs solicitados y no se duplican reuniones.
Este POST es de consulta; no importa ni envía convocatorias.

## GET /api/v1/meetings?id=ID

Devuelve la reunión completa; 404 si no existe.

## GET /api/v1/meetings?id=ID&attribute=durationMinutes

Forma equivalente: `?id=ID&durationMinutes`.

```json
{"id":"UUID", "attribute":"durationMinutes", "value":30}
```

Atributos permitidos: `subject`, `start`, `end`, `durationMinutes`, `personCount`,
`total`, `currency`, `hourlyTotal`, `costPerMinute`, `personHours`, `unknownCount`,
`people`, `costCenter`, `organizerEmail`, `outlookItemId`, `status`, `source`,
`generatedAt`, `captureEvent`, `recurrence`, `isRecurring`, `occurrenceCount`,
`seriesTotal`, `seriesStatus`. Un atributo permitido pero ausente en un registro
antiguo devuelve `null`. Atributos no permitidos o varios atributos: 400.

## Reuniones periódicas

`total`, `durationMinutes` y `personHours` corresponden a **una reunión**.
`seriesTotal` es `total * occurrenceCount` para una serie finita; devuelve `null`
si la serie no tiene fin, el cliente no permite leerla o supera el límite de cálculo.
`seriesStatus` distingue `single`, `finite`, `unbounded`, `unavailable` y `tooLarge`.
El cálculo utiliza fechas de calendario, sin desplazar ocurrencias por cambios de hora.

Al registrar una reunión, `meeting.recurrence` es `null` o un objeto como:

```json
{"type":"weekly","interval":1,"startDate":"2026-11-02","endDate":"2026-11-30","days":["mon","thu"],"firstDayOfWeek":"mon"}
```

Se admiten patrones `daily`, `weekly`, `monthly` y `yearly`, incluidas fechas de mes
y patrones relativos (`dayOfWeek`, `weekNumber`, `month`). En lugar de `endDate`
puedes indicar `numberOfOccurrences`; sin ambos se considera una serie sin fin.
El servidor vuelve a contar las ocurrencias y no confía en un total enviado por el cliente.
La expansión se limita a 200 años y las series numeradas a 100.000 reuniones.
Se estiman todas las ocurrencias del patrón con la duración y tarifas vigentes:
no se descuentan cancelaciones ni se reconstruyen excepciones individuales con Graph.

## Otras rutas

- `GET /api/rates`: catálogo de tarifas reconstruido desde las tablas SQL.
- `POST /api/estimates`: registra o actualiza una estimación desde el complemento.
  Cuerpo `{meeting, source, costCenterId, requestId}`; tarifas calculadas en el servidor.
  `meeting` incluye asunto, duración, asistentes y opcionalmente fechas, organizador e ID de Outlook.
  `source` es `outlook` o `demo`; `requestId` UUID v4 es obligatorio para Outlook.
  `costCenterId: null` elige el primer centro. Los overrides de tarifa se rechazan.
- `GET /api/estimates`: últimas 20 estimaciones (compatibilidad con la versión anterior).
- `GET /api/openapi.json`: especificación OpenAPI.
- `GET /healthz`: comprobación de proceso (no prueba la conexión a PostgreSQL).

Errores: 400 entrada inválida, 401 sin credenciales válidas, 403 origen/host no permitido,
404 ID/ruta desconocido, 409 ID ambiguo, 503 base de datos no disponible.

## Ejemplo PowerShell

```powershell
$headers = @{ Authorization = "Bearer $env:MEETING_COST_API_KEY" }
$body = @{ ids = @('ID-1', 'ID-2') } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://coste.example.com/api/v1/meetings/query' -Headers $headers -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri 'https://coste.example.com/api/v1/meetings?id=ID-1&attribute=durationMinutes' -Headers $headers
```

Para importar un evento no registrado desde Microsoft 365 se necesita una integración
adicional con Graph: registro de aplicación en Entra, tenant, consentimiento para leer
calendarios y el identificador del buzón, además del ID del evento. No está configurada
ni se solicitan permisos sobre tu buzón como parte de esta API.
