# Changelog

## v1.1.0

🎉 **Restorm ahora es también un diseñador de API.** Diseñe su API, sírvala como un mock en vivo en cinco protocolos a la vez y genere sus clientes — todo sin salir de la app, todo en su propio disco.

- **Un diseñador visual de API.** Modele su API a mano — modelos, enums (con nombre o inline), rutas, parámetros, ejemplos con nombre, restricciones, tags y deprecaciones — sin escribir una sola línea de especificación.
- **Sírvala como mock, con un clic, en 5 protocolos a la vez.** El diseño se convierte en un servidor que responde en HTTP, GraphQL, SOAP, OData y gRPC simultáneamente. Las respuestas provienen de sus ejemplos con nombre (o de datos realistas generados a partir de sus modelos), con validación de restricciones, latencia simulada y un modo con estado.
- **Clientes listos para ejecutar, generados automáticamente.** Mientras el mock se ejecuta, la sección Clients crea peticiones reales y ejecutables para cada protocolo activado, apuntadas a los endpoints del mock. Un clic abre una petición y golpea el servidor — se acabó reimportar su API en otro lugar para probarla.
- **Genere código** a partir de su diseño usando las plantillas proporcionadas y las suyas propias, renderizado en un entorno aislado y escrito en disco solo después de que usted lo confirme. **Exporte también el descriptor** (OpenAPI y más).
- **Al importar, los cuerpos de las peticiones se rellenan de antemano**: GraphQL selecciona los campos escalares del tipo de retorno, gRPC despliega los mensajes anidados — la petición se ejecuta tal cual.

## v1.0.6

Correcciones:

- **Un proyecto muy grande ahora falla al guardar con un mensaje claro en lugar de congelarse.** Si un proyecto crece demasiado para escribirse en el disco de una sola vez —algo que puede ocurrir tras importar un esquema de API inusualmente grande—, Restorm te avisa claramente de que es demasiado grande para guardarlo, en vez de bloquearse o fallar en silencio.
- **Informes de errores más claros entre bastidores.** Cancelar el diálogo «Guardar como» ya no se registra como un error, y una importación fallida ahora informa de su causa real, de modo que los problemas de verdad son más fáciles de detectar y corregir.

## v1.0.5

**Cookie jar — un tarro de cookies por entorno.**

- **Cada entorno conserva sus propias cookies.** Inicie sesión en su API de desarrollo y en su API de producción desde dos entornos y sus sesiones nunca se cruzarán: una cookie capturada en uno solo se reenvía en ese mismo. La caducidad, `Path`, `Domain` y sus subdominios, `Secure`, `HttpOnly` y `SameSite` ahora se respetan en lugar de descartarse.
- **Le presentamos Cookie jar.** Una nueva pestaña del área de trabajo —**Ver ▸ Cookie jar**— muestra las cookies de cada entorno agrupadas por dominio en paneles plegables: edite un valor, elimine una, vacíe un dominio o el tarro entero, o añada una cookie a mano. Se actualiza en directo a medida que sus peticiones establecen cookies.
- **Vea qué envió y recibió cada petición.** Cada petición tiene ahora una pestaña **Cookies** junto a Respuesta e Información, que muestra las cookies enviadas con la llamada y las cookies recibidas de vuelta —incluidas las cookies establecidas en una redirección que nunca llegan a la respuesta final. También está en las respuestas anteriores de su historial.
- **Los inicios de sesión con cookies funcionan sin más.** Una petición que devuelve `Set-Cookie` se captura y se reenvía automáticamente en las llamadas protegidas que siguen, incluso a lo largo de la ejecución de un escenario, donde cada paso comparte el tarro del entorno.
- **Las cookies se conservan como en un navegador.** Las cookies con caducidad se guardan por proyecto y se recargan al reabrirlo; las cookies de sesión se descartan al reiniciar, exactamente como haría un navegador.
- **Más allá de REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC y SSE ahora envían y almacenan cookies, y WebSocket las transporta en el handshake de la conexión.
- **Las cookies pueden usar sus variables.** Escriba `{{token}}` en una cookie que añada a mano y se resolverá con el entorno activo cuando salga la petición.

Correcciones:

- **El guardado automático ahora abarca los entornos dentro de carpetas.** Añadir o renombrar un subentorno se guarda de inmediato en el modo de guardado automático: se acabó el aviso «¿guardar antes de cerrar?» para un cambio que ya estaba destinado a estar en el disco.

## v1.0.4

**Inicie sesión una vez: todas sus ventanas le siguen.**

- **Su cuenta ahora le sigue entre ventanas.** Inicie sesión, ciérrela o cambie de plan en una ventana de Restorm y todas las demás ventanas abiertas lo adoptan al instante, sin reiniciar y sin una segunda conexión. Y al terminar un inicio de sesión en el navegador, la confirmación llega ahora a la ventana que la pidió, incluso con varias ventanas abiertas.

Correcciones:

- **Los nodos de código vuelven a arrancar en los Mac Intel**: la build de macOS Intel incluía un binario de esbuild compilado para Apple Silicon.
- **La acción «Nueva ventana» del lanzador AppImage vuelve a abrir una ventana**, y el comando `restorm` instalado por los paquetes .deb/.rpm vuelve a funcionar.
- **El arranque en Windows es más limpio** — la ventana se carga ahora mediante el protocolo de la aplicación, sin un repliegue silencioso tras un error interno en cada inicio.

## v1.0.3

**Restorm funciona en CI, sin FUSE.**

- **`restorm-cli` ya funciona en runners de CI y en contenedores.** La compilación de Linux se descomprime en vez de montarse: ya no hace falta FUSE, que Ubuntu ha dejado de incluir.

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
