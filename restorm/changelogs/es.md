# Changelog

## v1.1.1

**El diseñador de API ahora se maneja desde la barra lateral.**

- **Tus modelos, enums y rutas viven en la barra lateral.** Las tres listas de las pestañas desaparecen: los modelos (con su anidamiento por herencia), los enums y las rutas (grupos y sus rutas) están ahora directamente en el árbol de la barra lateral. Haz clic derecho para renombrar, añadir un submodelo o un subgrupo, clonar una ruta, generar el CRUD o eliminar; arrastra para reordenar o reasignar el padre, nunca fuera del diseño. Cada página muestra ahora solo el detalle del elemento seleccionado.
- **Una vista general de tus modelos, enums y rutas.** El nodo raíz de cada sección enumera ahora todo lo que contiene — y los Modelos añaden una pestaña **Gráfico**: un diagrama de clases de tus modelos con su herencia y referencias. Los enums muestran sus valores junto al nombre.
- **Un único lugar para renombrar.** Un modelo, enum o ruta se renombra desde su título grande (el lápiz), y un nombre vacío muestra **«<sin nombre>»** para que el lápiz siga siendo accesible — el nombre ya no aparece dos veces en la página.
- **Los errores de validación señalan el elemento.** Cuando algo va mal — un modelo y un enum que comparten nombre, una referencia a algo que ya no existe — una nota en la parte superior del modelo, enum o ruta lo explica.
- **Una ruta de navegación completa.** El rastro refleja toda la jerarquía de la barra lateral — carpetas › diseño › sección › grupo › elemento — y cada segmento es clicable.
- **Selecciona varios, elimina de una vez.** Selecciona varios modelos, enums o rutas y elimínalos de una sola vez, tras una confirmación.
- **Copia o abre la fuente de una plantilla de código con un clic.** En la página «</> Code», al pasar el ratón sobre una plantilla aparece un botón para copiar su URL o ruta y otro para abrirla: el repositorio en el navegador, o la carpeta en el disco si es local.
- **Las rutas nuevas empiezan con un nombre.** Una ruta creada desde cero recibe ahora un nombre por defecto, así puedes renombrarla enseguida.

Correcciones:

- **Elegir una plantilla de código cierra la biblioteca.** «Usar» ahora te devuelve directamente a la página Code.
- **La generación de documentación ya no falla con los campos opcionales.** Generar la documentación de un diseño cuyo modelo o parámetro dejaba «required» sin definir ya no se detiene con un error de plantilla.
- **Eliminar un enum pide confirmación.** Los enums reciben la misma confirmación que los modelos y las rutas.
- **La barra lateral revela lo que seleccionas.** Con «sincronizar la barra lateral con la pestaña activa» activado, seleccionar o crear un modelo, enum o ruta despliega sus padres para mantenerlo visible en el árbol.

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
