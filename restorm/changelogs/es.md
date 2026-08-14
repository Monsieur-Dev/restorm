# Changelog

## v1.0.2

**Sus tokens CLI/CI, sin salir de la aplicación.**

- **Cree, consulte y revoque sus tokens desde Restorm** —para usuarios Pro y Enterprise, desde el botón de cuenta en la barra de título—. Se acabó el viaje al panel de control para conseguir un token del pipeline que está escribiendo.
- **Los tokens pueden caducar.** Elija una duración al crearlos: de 7 a 365 días, o sin caducidad como hasta ahora. Un token caducado se rechaza igual que uno revocado.
- **Su organización puede delegar.** Un administrador puede permitir que un miembro concreto cree tokens y, por separado, darle acceso al registro de auditoría, sin convertirlo en administrador.
- **Restorm ya se instala desde npm.** `npm i -g restorm-cli` y luego `restorm`: la aplicación se abre en Linux, macOS y Windows sin pasar por un instalador. La compilación se descarga una sola vez, se verifica con su suma de comprobación publicada y se guarda en caché, de modo que una canalización deja de descargarla en cada trabajo.

## v1.0.1

**Primer parche: mover elementos en la barra lateral, nombres de pestañas e informes de fallos.**

- **Mover un elemento en la barra lateral ya no rompe la aplicación.** Con el mini navegador, los Ajustes o los registros MCP abiertos, arrastrar cualquier fila de la barra lateral destrozaba la interfaz y solo un reinicio la recuperaba.
- **Renombrar un elemento ahora actualiza todas las pestañas abiertas**, incluidas las de un panel dividido y las de cualquier tipo de petición (gRPC, GraphQL, Redis…), que conservaban su nombre anterior hasta volver a abrirlas.
- **Los informes de fallos vuelven a llegarnos.** Con el envío de informes activado, 1.0.0 no enviaba nada en silencio: un fallo que sufrías no nos decía nada.
- **La ilustración de «lenguajes de código» vuelve a mostrar sus logotipos.**

## v1.0.0

**Restorm 1.0 — el cliente de API local-first, ya disponible.**

Restorm es un cliente de escritorio rápido y offline-first para probar y ejecutar APIs en todos los protocolos principales.

- **Protocolos**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Escenarios**: encadena solicitudes de forma visual, ramifica/itera, extrae y reutiliza valores, ejecuta sin interfaz en CI.
- **Entornos y variables**: `{{handlebars}}` en todas partes, secretos tipados, entornos por carpeta.
- **Importación/Exportación**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, exportación de código.
- **Proyectos nativos de Git**: tu proyecto `.restorm` es un archivo sencillo: versiónalo, compáralo y resuelve conflictos en la app.
- **Local-first y privado**: todo se ejecuta en tu máquina; un cortafuegos de salida controla cada llamada externa.
- **Multiplataforma**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edición Community gratuita, con Pro y Enterprise para equipos.
