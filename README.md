# Meeter — prototipo de complemento Outlook

Calculadora de coste **estimado**, con un panel lateral en una convocatoria de Outlook y un modo demo independiente. JavaScript con módulos ES, HTML y CSS, servidor Node.js local y persistencia opcional en PostgreSQL de Neon.

La marca visible del complemento es **Meeter**. La cabecera muestra únicamente el logo y el nombre; debajo aparece el coste estimado. Para series periódicas se muestra el coste por reunión y, en pequeño, el total de la serie y su número de reuniones. Sin fecha de fin no se inventa un importe total. Las cifras de serie asumen igual duración, participantes y tarifas para todas las ocurrencias; no incluyen excepciones o cancelaciones individuales.

La periodicidad se lee con Mailbox 1.7 y se actualiza al cambiar el patrón. En clientes sin esa API se indica que la periodicidad no está disponible. La demo permite activar una serie y elegir frecuencia, intervalo y número de reuniones o una serie sin fin. El mismo cálculo se utiliza en JSON, PostgreSQL y API. Para que Outlook muestre el nuevo nombre, vuelve a cargar [manifest.xml](./manifest.xml), versión 1.1.0.0; se conserva el ID del complemento.

## PostgreSQL en Neon

La configuración [neon.ts](./neon.ts) y el enlace local `.neon` utilizan el proyecto y la rama seleccionados en la CLI. Para recuperar la configuración en otro equipo:

```sh
neon login
neon deploy
npm install
npm run db:migrate
npm run build
npm run certs
npm start
```

`neon deploy` configura servicios de Neon; no publica esta web. El servidor continúa en https://localhost:3000/taskpane.html?demo=1.

El servidor carga `.env.local` y `.env`, dando prioridad a las variables del proceso y después a `.env.local`. Usa `DATABASE_URL` con un pool reutilizable de `pg` para las peticiones y `DATABASE_URL_UNPOOLED` para migraciones transaccionales. Ambas conexiones verifican TLS. No expongas estas variables en el navegador. Los archivos de entorno están excluidos de Git y no se sirven por HTTP.

Las migraciones numeradas crean el esquema `meeting_cost`. [002_relational_catalog.sql](./migrations/002_relational_catalog.sql) convierte el catálogo JSON anterior en una tabla SQL con una fila por empleado: `employee_id`, `email`, `name`, `position`, `cost` (por hora), `currency` y `active`. Puedes editarla directamente en Neon. [docs/catalog.sql](./docs/catalog.sql) contiene ejemplos de alta, modificación, desactivación y eliminación.

La configuración general vive en `settings`; centros y exclusiones en `cost_centers` y `excluded_emails`. Todas las tarifas usan la moneda común de `settings`; no se convierten monedas. La migración conserva el JSON original en `rate_catalog_legacy` como copia, pero la aplicación ya no lo utiliza. Las estimaciones históricas conservan sus importes y participantes. El registro `schema_migrations` evita volver a aplicar cambios o reinsertar empleados eliminados. Prueba primero las migraciones en una rama de desarrollo de Neon.

## API y despliegue en otro servidor

- [Referencia de la API y ejemplos](./docs/api.md): POST por ID/lista y consulta de atributos mediante GET.
- [OpenAPI 3.1](./docs/openapi.json), disponible también en `/api/openapi.json` con autenticación.
- [Guía para servidor HTTPS y otros PCs](./docs/deployment.md): Docker, proxy, variables y manifiesto para tu dominio.

```text
POST /api/v1/meetings/query          {"id":"UUID-o-ID-Outlook"}
POST /api/v1/meetings/query          {"ids":["ID-1","ID-2"]}
GET  /api/v1/meetings?id=ID&attribute=durationMinutes
GET  /api/v1/meetings?id=ID&durationMinutes
```

Estas rutas recuperan estimaciones ya registradas. Importar eventos no registrados desde Microsoft 365 exige una integración con Graph y consentimiento sobre el buzón, que no se configura aquí. Los nuevos registros guardan el UUID interno y el ID EWS de Outlook cuando está disponible. No se confunde este último con un ID de Microsoft Graph.

Con `DATABASE_URL` configurada, el panel obtiene las tarifas desde PostgreSQL mediante `GET /api/rates`. Las tarifas son de solo lectura tanto en el panel como en la API: no se aceptan overrides manuales. La descarga JSON se ofrece con un icono y texto al pasar el cursor. El desglose se despliega para consultar el asistente y su tarifa; un triángulo marca las tarifas genéricas. No hay botones para actualizar o guardar, ni historial en pantalla.

### Guardado automático al enviar desde Outlook

[manifest.xml](./manifest.xml) registra `ItemSend` en `VersionOverridesV1_1`. [commands.html](./commands.html) carga el controlador generado por el build, que funciona independientemente del panel. Al pulsar Enviar o Enviar actualización, lee los datos actuales y llama a `POST /api/estimates`. El servidor recalcula el coste con el catálogo vigente en Neon. Solo permite continuar cuando el guardado responde correctamente. Si falla o supera 25 segundos, bloquea ese intento y muestra un aviso para reintentar.

Un UUID en las propiedades del elemento identifica la estimación: los reintentos y las actualizaciones de la misma convocatoria actualizan su fila sin duplicarla. El centro elegido se conserva también como propiedad del borrador. Si nunca se abre el panel, se aplica el primer centro del catálogo. Se guardan asunto, participantes, tarifas y centro de coste; usa datos ficticios para las pruebas. Los correos normales no generan estimaciones.

**Límite del evento:** `ItemSend` ocurre antes del envío. `captureEvent: "ItemSend"` registra un intento autorizado por el complemento, no confirma entrega ni evita que otro complemento bloquee después la convocatoria. La demo del navegador no envía ni guarda automáticamente estimaciones.

**Compatibilidad e instalación:** vuelve a cargar el manifiesto actualizado en Outlook. El evento requiere un cliente y servidor compatibles con Mailbox 1.8, además de las políticas de instalación pertinentes (puede requerir al administrador). Outlook 2019 no garantiza ese soporte: las ediciones perpetuas con Mailbox 1.6 mantendrán el cálculo y la descarga, pero no ejecutarán el guardado al enviar. El panel muestra un aviso cuando no se declara Mailbox 1.8. Consulta [compatibilidad de ItemSend](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-on-send-addins) y [requisitos de Outlook](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/outlook/outlook-api-requirement-sets).

El validador de Marketplace rechaza intencionadamente `ItemSend`; no implica un error de esquema para una instalación privada. No se publica este complemento. `npm run validate` debe revisarse para distinguir ese rechazo esperado de cualquier otro error.

Sin `DATABASE_URL`, la demo mantiene el catálogo JSON local y desactiva el guardado. Si la base está configurada pero falla, se muestra el error; no se sustituyen silenciosamente las tarifas por otras locales. Para cambiar tarifas persistentes, edita las filas de `meeting_cost.rate_catalog` en Neon; editar el JSON solo afecta al modo local y a la semilla inicial.

En desarrollo el servidor escucha en `127.0.0.1`. En producción se configura `PUBLIC_BASE_URL`, `HOST`, `PORT` y un secreto `SERVICE_API_KEY`; el arranque rechaza la configuración pública sin protección. La API comprueba Host y Origin y admite Bearer para integraciones o Basic sobre HTTPS para el panel. Es un servicio compartido de una organización, sin separación por usuario ni soporte multiempresa. El manifiesto remoto se genera para el dominio configurado y no contiene secretos. Consulta la guía de despliegue antes de publicarlo.

Validación:

```sh
npm run build
npm test
# Con npm start activo y las variables de Neon disponibles:
npm run test:integration
npm run test:deployment
```

El build comprueba los tipos de [neon.ts](./neon.ts), la sintaxis JavaScript y genera los recursos públicos en `dist/`, que el servidor utiliza cuando existen. Repite el build tras editar la interfaz. La prueba de integración verifica HTTPS con la CA de desarrollo, catálogo contra PostgreSQL, validación de entradas/origen, guardado y lectura del historial. Elimina únicamente la estimación ficticia creada por esa prueba.

## 1. Requisitos

- Node.js 20 o posterior (versión LTS recomendada), con npm.
- VS Code u otro editor.
- Para instalarlo: buzón Outlook.com o Microsoft 365 y un cliente Outlook compatible con complementos de calendario. Empezar en navegador o nuevo Outlook.
- Acceso a Internet para instalar dependencias y cargar Office.js en Outlook.

No basta con abrir una cuenta Gmail/IMAP en Outlook. Las políticas de una empresa pueden impedir complementos personalizados. Las cuentas personales no permiten validar todo el flujo empresarial de asistencia de Teams.

## 2. Arranque rápido: demo sin Outlook

Descomprime el ZIP, abre **la carpeta `meeting-cost`** en VS Code y abre su terminal:

```sh
npm run demo
```

Abre esta URL exacta:

http://localhost:3001/taskpane.html?demo=1

Instala las dependencias con `npm install` antes de iniciar el servidor. Introduce correos separados por coma, punto y coma o salto de línea. Cambia la duración o el centro de coste; las tarifas proceden del catálogo y no se editan en pantalla. Los valores iniciales suman **122,50 EUR para 30 minutos**, con cuatro personas incluido el organizador.

No envía invitaciones, mensajes ni datos a APIs externas. Detén el servidor con Ctrl+C.

## 3. Personaliza las tarifas

En modo local sin PostgreSQL, edita `data/rates.json` (con Neon, consulta la sección anterior):

- `currency`: una moneda común, por ejemplo `EUR`.
- `defaultHourlyRate`: tarifa para asistentes desconocidos, mostrados con una advertencia.
- `employees`: correo, categoría y coste por hora. Cambia `organizador@ejemplo.com` por tu correo para probar tu tarifa como organizador.
- `excludedEmails`: salas, buzones técnicos u otros correos que no deben computar.
- `costCenters`: centros de coste disponibles.

Los correos se comparan sin distinguir mayúsculas y eliminando espacios exteriores. No repitas correos en el catálogo. Se admite tarifa cero. Tras modificar tarifas, reconstruye los recursos locales si procede y recarga el panel. El panel no permite editar tarifas.

## 4. Ejecuta el complemento por HTTPS

Desde la carpeta del proyecto:

```sh
npm install
npm run certs
npm start
```

`npm run certs` instala un certificado de desarrollo local con las herramientas de Microsoft. Puede pedir confirmación del sistema para confiar en él. No aceptes una excepción de certificado como sustituto de la instalación correcta.

Con el servidor activo, abre:

https://localhost:3000/taskpane.html?demo=1

Comprueba que la demo carga por HTTPS sin advertencia de certificado. El parámetro demo es solo para esta comprobación; el manifiesto abre el panel sin ese parámetro.

**No cierres la terminal del servidor mientras pruebes Outlook.** Nunca empaquetes claves privadas ni certificados en el proyecto. Los certificados los gestiona `office-addin-dev-certs` fuera de esta carpeta.

## 5. Instala el manifiesto en tu cuenta (sideloading)

1. Inicia sesión con el buzón donde quieras probarlo.
2. Abre https://aka.ms/olksideload en el navegador.
3. Busca **Mis complementos → Complementos personalizados → Agregar un complemento personalizado → Agregar desde archivo**.
4. Selecciona `manifest.xml` de este proyecto y confirma la instalación.
5. Crea una reunión desde el calendario como **organizador**; abre la edición completa o una ventana independiente si no aparecen los complementos en el editor compacto.
6. Busca **Meeting Cost / Coste de reunión**, posiblemente dentro de Aplicaciones o del menú de más opciones, y abre su panel.
7. Añade los correos de ejemplo como asistentes y selecciona una duración.

La ubicación exacta del botón depende del cliente. Si la carga personalizada no está disponible en tu cuenta, consulta las políticas o utiliza un buzón Microsoft 365 de pruebas. No es necesario publicar en Marketplace. En Outlook clásico puede haber retraso por caché después de instalar.

### Qué sucede mientras el panel está abierto

Lee organizador, asistentes obligatorios/opcionales, asunto y fechas mediante Office.js. Se suscribe a los eventos de destinatarios y horario cuando el cliente los admite. Como respaldo consulta cada 3 segundos mientras el panel está visible, sin mostrar mensajes periódicos ni controles de actualización.

El cálculo visual se actualiza al resolver los destinatarios y cambiar la duración. El controlador de envío es independiente del panel. Solo se añaden metadatos propios del complemento al borrador; no se cambia el asunto, cuerpo ni destinatarios.

## 6. Prueba de aceptación en tu Outlook

No envíes la convocatoria: el borrador basta.

1. Usa tu correo como organizador y asígnale 70 EUR/h en el JSON.
2. Añade junior (25), senior (50) y director (100), usando sus correos del JSON.
3. Para 30 minutos debes ver 4 personas, 122,50 EUR y 2 horas-persona.
4. Cambia a 60 minutos: 245 EUR y 4 horas-persona.
5. Añade un correo desconocido: se aplica 40 EUR/h y aparece un triángulo junto a su fila del desglose desplegable, con explicación al pasar el cursor o enfocar el icono.
6. Elimina un asistente y verifica el recálculo. Añadir al organizador otra vez no lo duplica.
7. Añade `sala@ejemplo.com`: no computa. Los recursos reconocidos como tales por Outlook también se excluyen.
8. Selecciona un centro de coste y exporta el JSON. Comprueba que el reporte es `estimated` y contiene el centro elegido.

Un grupo de distribución no se expande automáticamente: será un correo y puede quedar con tarifa genérica. Añade personas individualmente para esta prueba. No se infiere si un opcional asistirá: todos los invitados cuentan en el estimado.

## 7. Pruebas y validación

```sh
npm test
npm run validate
```

`npm test` usa el runner integrado de Node y prueba cálculo, duplicados, exclusión de recursos, tarifa genérica, tarifa cero y entradas inválidas. También prueba el controlador ItemSend con Office simulado: lectura actual, ID estable, errores, tiempo de espera y exclusión de correos normales. `npm run test:integration` conecta ese controlador simulado a HTTPS y Neon reales, sin enviar convocatorias.

`npm run validate` utiliza el validador oficial del manifiesto; requiere acceso a su servicio remoto. El esquema XML pasa; el rechazo de Marketplace por contener ItemSend es esperado y está explicado arriba. Si falla por conectividad, no significa que el manifiesto haya sido aprobado o rechazado.

### Validación realizada al preparar este paquete

- Cuatro pruebas del motor: correctas.
- JSON de ejemplo y XML: parseables.
- Servidor demo: HTML, JavaScript, JSON e iconos responden correctamente; archivos de proyecto fuera de la lista pública devuelven 404.
- Prueba visual automatizada: pendiente; no había navegador disponible en el entorno y su descarga no pudo completarse.
- Validación oficial remota: **pendiente**, el servicio no fue accesible desde el entorno de preparación.
- Instalación y ejecución dentro de Outlook: **pendientes de tu cuenta y cliente**. No se ha simulado su aprobación.

## 8. Qué incluye y qué falta

Incluye coste estimado total y por minuto, horas-persona, desglose desplegable de tarifas de solo lectura, centros de coste, exportación JSON y demo.

Incluye guardado automático de estimaciones en PostgreSQL mediante el evento ItemSend de clientes compatibles. No incluye todavía buzón receptor, recurrencia anual, envío de correos/webhooks, autenticación empresarial ni asistencia real de Teams/Graph. El centro de coste se conserva en el JSON, en PostgreSQL y como metadato propio del complemento en la convocatoria.

El catálogo de tarifas se sirve al navegador/panel y el desglose contiene correos y tarifas. Usa datos ficticios para este prototipo. Una versión empresarial debe resolver el control de acceso y decidir qué información devuelve el servidor al cliente.

## 9. Estructura

```text
meeting-cost/
  manifest.xml           Registro del botón y panel de Outlook
  taskpane.html          Interfaz del panel y demo
  commands.html          Página de soporte del manifiesto
  src/app.js             Adaptador Office.js, demo y UI
  src/calculator.js      Cálculo independiente de Outlook
  src/styles.css         Estilos
  data/rates.json        Catálogo de ejemplo
  scripts/server.mjs     Servidor local HTTP/HTTPS
  test/calculator.test.js
  assets/                Iconos PNG
  package.json
  package-lock.json
```

## 10. Solución de problemas

- **No aparece el botón:** confirma cuenta Microsoft, calendario, modo organizador y edición completa; recarga Outlook después de instalar. Comprueba políticas empresariales.
- **No se detectó Outlook:** fuera de Outlook usa `?demo=1`. La página sin ese parámetro espera al host de Office.
- **API no disponible:** usa un cliente compatible y reabre el panel; este informa del error y deja de mostrar un importe válido si no puede leer los datos.
- **Panel en blanco o HTTPS bloqueado:** ejecuta `npm run certs`, comprueba que el servidor sigue activo y que https://localhost:3000 responde desde tu navegador.
- **Puerto ocupado:** cierra la instancia previa. Cambiar el puerto de HTTPS exige actualizar todas sus referencias en el servidor y manifiesto.
- **Tarifa incorrecta:** edita el JSON, incluye el correo real del organizador y recarga. Los alias diferentes no se fusionan automáticamente.
- **Exportación bloqueada por el cliente:** usa la demo para exportar o prueba Outlook web; las descargas desde paneles dependen del cliente/políticas.

Para desinstalar, vuelve a Mis complementos y elimina Meeting Cost. Detén el servidor con Ctrl+C.

## Documentación oficial

- https://learn.microsoft.com/en-us/office/dev/add-ins/quickstarts/outlook-quickstart-yo
- https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/sideload-outlook-add-ins-for-testing
- https://learn.microsoft.com/en-us/javascript/api/outlook/office.appointmentcompose
- https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview
