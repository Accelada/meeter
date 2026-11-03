# Servidor HTTPS y complemento en otros equipos

Para varias empresas y cuentas personales, consulta [el despliegue multiempresa](./companies.md).
La autenticación compartida descrita abajo corresponde al modo anterior; en el modo
multiempresa `SERVICE_API_KEY` se reserva al operador y los empleados usan sus cuentas.

Se prepara el despliegue; estos archivos no publican el proyecto ni eligen un proveedor.
Necesitas un dominio propio, un servidor Node.js 20+ con acceso saliente a Neon y un
certificado HTTPS válido para ese dominio. Los otros PCs no necesitan Node ni la base
de datos: Outlook descarga el panel, scripts y manifiesto desde tu servidor.

## Variables del servidor

```dotenv
NODE_ENV=production
PUBLIC_BASE_URL=https://coste.example.com
SERVICE_API_KEY=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO_DE_32_CARACTERES_O_MAS
DATABASE_URL=CONEXION_NEON_POOLED
DATABASE_URL_UNPOOLED=CONEXION_NEON_DIRECTA_SOLO_PARA_MIGRACIONES
TLS_TERMINATION=proxy
HOST=0.0.0.0
PORT=3000
```

Guarda secretos mediante el gestor de secretos del proveedor o un archivo de entorno
privado fuera de Git. Una forma de generar la clave es
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
No utilices la clave de ejemplo anterior. El arranque rechaza producción sin URL HTTPS,
base de datos o clave suficiente. `TLS_TERMINATION=proxy` significa que un proxy de
confianza termina HTTPS y reenvía a Node por una conexión interna; no publiques ese
puerto HTTP directamente en Internet. Sin proxy se conserva el HTTPS de desarrollo,
que no debe usarse como certificado público.

## Instalación nativa

```sh
npm ci
npm run db:migrate
npm run build
npm start
```

El servidor genera `/manifest.xml` dinámicamente a partir de `PUBLIC_BASE_URL`.
Para descargar un archivo listo para instalar antes de arrancar:

```sh
npm run manifest -- https://coste.example.com
```

El resultado es `dist/manifest.xml`. Cambia el origen de todas las referencias del
manifiesto; no cambia IDs del complemento ni incrusta contraseñas.

## Docker y proxy

```sh
docker build -t meeting-cost .
docker run -d --name meeting-cost --env-file /ruta/privada/meeting-cost.env -p 127.0.0.1:3000:3000 meeting-cost
```

La imagen excluye los archivos de entorno y `.neon`. Las dependencias de desarrollo
se usan al construir y se eliminan de la imagen final. Aplica las migraciones con
el mismo entorno antes de poner la nueva versión en servicio; también puedes ejecutar
`docker exec meeting-cost node scripts/migrate.mjs` si la conexión directa está disponible.

Adapta [nginx.conf.example](../deploy/nginx.conf.example) con tu dominio y certificados.
El proxy debe conservar Host y Authorization; no se confía en X-Forwarded-Host para
decidir el origen permitido. No añadas cabeceras que impidan embeber el panel en Office.
No hay escalado, copias del servidor ni rotación de secretos automatizados en este ejemplo.

## Instalar desde otro PC

1. Comprueba que `https://coste.example.com/healthz` responde y que el panel abre con
   certificado válido. Usuario de acceso: `meeting-cost`; contraseña: clave del servicio.
2. Descarga `https://coste.example.com/manifest.xml` o usa el archivo generado para tu dominio.
3. Instálalo como complemento personalizado en el buzón de pruebas. `ItemSend` puede
   requerir instalación por el administrador; no admite distribución por Marketplace.
4. Abre el panel desde una convocatoria y autentica el acceso en el entorno de Outlook.
   El caché de credenciales del navegador externo puede no compartirse con el de Office.
5. Comprueba el cálculo y la descarga con datos ficticios. El evento de envío requiere
   Mailbox 1.8 y una combinación compatible de cliente/Exchange. Outlook 2019 limitado
   a 1.6 no ejecuta el guardado automático. No basta con cambiar la URL del manifiesto.
6. Comprueba con una prueba autorizada de envío que el runtime del evento comparte el
   acceso al servicio. El complemento no confirma entrega; conserva la estimación previa al envío.

El usuario compartido protege un servicio de una organización. Antes de usarlo en varias
organizaciones o exigir auditoría por usuario, integra identidad corporativa y permisos.
La compatibilidad de autenticación y envío debe comprobarse en cada cliente real.
