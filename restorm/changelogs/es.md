# Changelog

## v1.2.1

**Código fuente público, dependencias más seguras.**

- **El código de Restorm ya es público.** Toda la aplicación puede consultarse en GitHub — [github.com/Monsieur-Dev/restorm](https://github.com/Monsieur-Dev/restorm) — bajo una licencia «source-available»: compruebe usted mismo cómo se tratan sus datos, informe de una vulnerabilidad o contribuya.
- **Actualizaciones de seguridad generalizadas.** Electron pasa a la versión 43.8 y las bibliotecas que incorpora Restorm se llevan a sus versiones corregidas: el saneador de HTML, el motor de plantillas, las capas HTTP, gRPC y XML, el lector de archivos comprimidos, el SDK de MCP. Se cierran más de doscientos avisos de seguridad conocidos.
- Nada cambia en sus proyectos: mismo formato de archivo, mismos ajustes.

## v1.2.0

**Grabe una página web y obtenga su API en forma de solicitudes.**

- **Sesiones de grabación.** Un nuevo tipo de elemento de la barra lateral abre una página web en el mininavegador integrado y captura cada llamada API que realiza — REST, GraphQL, gRPC-web y WebSocket — en directo, con listas blanca y negra en expresiones regulares, pausa y detención desde la línea de dirección, y un halo pulsante alrededor de la sesión mientras se ejecuta. Cada llamada capturada se lee exactamente como la respuesta de una solicitud (cuerpo, información, cookies, grafo); el menú contextual de una llamada añade su url a una lista, con la opción de depurar lo ya capturado. Las capturas permanecen en memoria, limitadas por un nuevo ajuste de la aplicación, y nunca tocan su archivo de proyecto.
- **Deducir las rutas (Pro).** Un botón transforma las capturas en un árbol de carpetas de solicitudes reales y reproducibles: los segmentos de ruta variables se convierten en parámetros de ruta `{{param}}`, las carpetas siguen los prefijos estáticos, las llamadas gRPC-web se ordenan por servicio y cada solicitud se rellena de antemano a partir de la última llamada correcta, con las llamadas capturadas en su historial de respuestas. Volver a deducir fusiona — sus modificaciones se conservan.
- **Contrólelo desde su asistente de IA.** Diez herramientas MCP crean y configuran sesiones, inician y detienen una grabación, leen las capturas y deducen las rutas.
- **Comparta su ubicación con el mininavegador (opcional).** Un nuevo ajuste de Privacidad, desactivado por defecto, permite a las páginas abiertas en el navegador integrado — durante una grabación o no — leer su ubicación aproximada, como lo haría la función de localización del propio sitio en un navegador normal. Activarlo pide primero su consentimiento; la ubicación proviene del servicio de localización del sistema (GeoClue en Linux) y, en su defecto, de una estimación a nivel de ciudad basada en su dirección IP. Desactivarlo olvida la ubicación de inmediato.
- **Pestaña Respuesta más completa.** Las imágenes ahora se muestran integradas, los vídeos y el audio se reproducen, el Markdown se renderiza y el editor de código elige el lenguaje según el Content-Type — con un botón Descargar traducido siempre a mano. Una respuesta binaria reproducida desde el historial ya no muestra su base64.
- **Importación: una especificación JSON pegada se lee bien.** Un documento JSON de una sola línea pegado en el campo de importación vacío se formatea de forma legible antes de abrirse en el editor.
- **Las listas largas siguen siendo rápidas.** La lista de capturas (y la barra lateral a partir de 400 filas) solo renderiza lo que está en pantalla.
- Los archivos de proyecto que contienen una sesión de grabación se guardan en el formato 1.2; las versiones anteriores de Restorm le piden actualizar antes de abrirlos.

## v1.1.4

**Conecte su asistente de IA en macOS — ahora de forma fiable.**

- **Corregido: Claude Desktop y Cursor en macOS.** Conectar un asistente de IA cargaba las herramientas de Restorm, pero luego cada llamada fallaba con «no hay ninguna instancia en ejecución», incluso con Restorm abierto — la app y el conector se buscaban en carpetas temporales distintas. Ahora se encuentran de forma fiable, sea cual sea lo que haya iniciado el conector.
- **Tratamiento formal en italiano, polaco y finés.** La interfaz ahora se dirige a usted en el registro formal en estos tres idiomas, en coherencia con el resto.
- **Acción Code en escenarios — más limpia, con ejemplos integrados.** El nodo Code ya no se estira cuando el script es largo, y su editor gana una pestaña **¿Necesita ayuda?** que muestra un ejemplo listo para ejecutar en el lenguaje que haya elegido (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Pegar con el editor abierto ya no deja un nodo Code suelto en el lienzo.
- **Detecte problemas de diseño en sus API importadas.** Tras importar una API — o al reabrir un archivo —, Restorm comprueba discretamente cada API en busca de problemas estructurales (rutas duplicadas, respuestas ausentes, rutas que entran en conflicto con el Mock Server…), la señala en la barra lateral con un «!» y añade una pestaña «Problemas» que enumera cada problema y las rutas exactamente afectadas, con cada ruta desplegable hacia su documentación.

## v1.1.3

**Conecte su asistente de IA a Restorm.**

- **Con un clic, desde la app.** El menú MCP de la barra de estado ahora ofrece «Añadir Restorm a su asistente de IA» — configuración lista para pegar para Claude Code, Claude Desktop y Cursor, además de «Añadir a Claude Code» con un clic.
- **O con una línea, en cualquier parte.** Apunte cualquier cliente MCP a su Restorm en ejecución con `npx -y restorm-mcp` — el puente lo encuentra por sí solo, sin ningún puerto ni token que copiar.
- **Un plugin para Claude Code.** Ejecute `/plugin marketplace add Monsieur-Dev/restorm` y luego instale el plugin `restorm`.

Consulte [Conectar su asistente de IA](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Compatibilidad con OpenAPI 3.2.**

- **Importe especificaciones OpenAPI 3.2.** El método `QUERY`, los verbos personalizados (`additionalOperations`), el parámetro de query string y los tipos de medio en streaming se importan como peticiones listas para ejecutar.
- **Examine un archivo para importar.** Un botón Examinar en el diálogo de importación abre un selector de archivos nativo — se acabó teclear o arrastrar una ruta.
- **Vista dividida para pegados grandes.** Al pegar una especificación de varias líneas se abre un editor de código a la izquierda y la vista previa a la derecha, con un separador ajustable.
- **Importación tolerante.** Una especificación con algún `$ref` roto importa todas las rutas que puede y muestra un aviso con lo que ha tenido que omitir.

Correcciones:

- Importar una especificación no válida o inaccesible muestra un mensaje claro en lugar de abrir el diálogo de informe de fallo.
- La vista de detalle del informe de fallo vuelve a desplazarse.
- Los fondos de los diálogos ya no se difuminan.

## v1.1.1

**El diseñador de API ahora se maneja desde la barra lateral.**

- **Sus modelos, enums y rutas viven en la barra lateral.** Las tres listas de las pestañas desaparecen: los modelos (con su anidamiento por herencia), los enums y las rutas (grupos y sus rutas) están ahora directamente en el árbol de la barra lateral. Haga clic derecho para renombrar, añadir un submodelo o un subgrupo, clonar una ruta, generar el CRUD o eliminar; arrastre para reordenar o reasignar el padre, nunca fuera del diseño. Cada página muestra ahora solo el detalle del elemento seleccionado.
- **Una vista general de sus modelos, enums y rutas.** El nodo raíz de cada sección enumera ahora todo lo que contiene — y los Modelos añaden una pestaña **Gráfico**: un diagrama de clases de sus modelos con su herencia y referencias. Los enums muestran sus valores junto al nombre.
- **Un único lugar para renombrar.** Un modelo, enum o ruta se renombra desde su título grande (el lápiz), y un nombre vacío muestra **«<sin nombre>»** para que el lápiz siga siendo accesible — el nombre ya no aparece dos veces en la página.
- **Los errores de validación señalan el elemento.** Cuando algo va mal — un modelo y un enum que comparten nombre, una referencia a algo que ya no existe — una nota en la parte superior del modelo, enum o ruta lo explica.
- **Una ruta de navegación completa.** El rastro refleja toda la jerarquía de la barra lateral — carpetas › diseño › sección › grupo › elemento — y cada segmento es clicable.
- **Seleccione varios, elimine de una vez.** Seleccione varios modelos, enums o rutas y elimínelos de una sola vez, tras una confirmación.
- **Copie o abra la fuente de una plantilla de código con un clic.** En la página «</> Code», al pasar el ratón sobre una plantilla aparece un botón para copiar su URL o ruta y otro para abrirla: el repositorio en el navegador, o la carpeta en el disco si es local.
- **Las rutas nuevas empiezan con un nombre.** Una ruta creada desde cero recibe ahora un nombre por defecto, así puede renombrarla enseguida.
- **Pestañas de vista previa, como en su editor.** Un solo clic abre ahora un elemento en una pestaña de **vista previa** reutilizable (su nombre en cursiva); hacer clic en otro elemento reutiliza la misma pestaña en lugar de apilar una nueva. Un doble clic, cualquier edición o ejecutar una petición la deja abierta para siempre. Desactívelo en Ajustes › Comportamiento.
- **Fije las pestañas que mantiene abiertas.** Haga clic derecho en una pestaña y fíjela: las pestañas fijadas se quedan primero, sobreviven a «cerrar las demás» y se recuerdan por proyecto.
- **Los entornos tienen una vista de detalle en condiciones.** Abra un entorno para renombrarlo desde su título, elegir su icono y color y añadir un subentorno — y el menú contextual ahora duplica un entorno con todas sus variables y subentornos.

Correcciones:

- **Elegir una plantilla de código cierra la biblioteca.** «Usar» ahora le devuelve directamente a la página Code.
- **La generación de documentación ya no falla con los campos opcionales.** Generar la documentación de un diseño cuyo modelo o parámetro dejaba «required» sin definir ya no se detiene con un error de plantilla.
- **Eliminar un enum pide confirmación.** Los enums reciben la misma confirmación que los modelos y las rutas.
- **La barra lateral revela lo que selecciona.** Con «sincronizar la barra lateral con la pestaña activa» activado, seleccionar o crear un modelo, enum o ruta despliega sus padres para mantenerlo visible en el árbol.
- **El botón de entorno se mantiene legible sobre cualquier color.** Su texto cambia ahora a claro u oscuro para seguir siendo legible sobre el color del entorno, igual que el botón de ejecución.
- **El clic central cierra un archivo abierto.** Hacer clic central en una entrada de la lista «Abiertos» de la barra lateral cierra su pestaña — y un nuevo ajuste de Comportamiento le permite ocultar ese panel por completo.
- **Texto más claro al partir de la documentación.** En la documentación de una API importada, el botón ahora dice «Crear una nueva petición a partir de esta documentación».
- **El inicio de sesión funciona en la versión de Microsoft Store.** La devolución de llamada de protocolo personalizado que el navegador entrega tras iniciar sesión ahora está declarada en el paquete de la Store, así que el inicio de sesión se completa en lugar de expirar.

## v1.1.0

🎉 **Restorm ahora es también un diseñador de API.** Diseñe su API, sírvala como un mock en vivo en cinco protocolos a la vez y genere sus clientes — todo sin salir de la app, todo en su propio disco.

- **Un diseñador visual de API.** Modele su API a mano — modelos, enums (con nombre o inline), rutas, parámetros, ejemplos con nombre, restricciones, tags y deprecaciones — sin escribir una sola línea de especificación.
- **Sírvala como mock, con un clic, en 5 protocolos a la vez.** El diseño se convierte en un servidor que responde en HTTP, GraphQL, SOAP, OData y gRPC simultáneamente. Las respuestas provienen de sus ejemplos con nombre (o de datos realistas generados a partir de sus modelos), con validación de restricciones, latencia simulada y un modo con estado.
- **Clientes listos para ejecutar, generados automáticamente.** Mientras el mock se ejecuta, la sección Clients crea peticiones reales y ejecutables para cada protocolo activado, apuntadas a los endpoints del mock. Un clic abre una petición y golpea el servidor — se acabó reimportar su API en otro lugar para probarla.
- **Genere código** a partir de su diseño usando las plantillas proporcionadas y las suyas propias, renderizado en un entorno aislado y escrito en disco solo después de que usted lo confirme. **Exporte también el descriptor** (OpenAPI y más).
- **Al importar, los cuerpos de las peticiones se rellenan de antemano**: GraphQL selecciona los campos escalares del tipo de retorno, gRPC despliega los mensajes anidados — la petición se ejecuta tal cual.

## v1.0.6

Correcciones:

- **Un proyecto muy grande ahora falla al guardar con un mensaje claro en lugar de congelarse.** Si un proyecto crece demasiado para escribirse en el disco de una sola vez —algo que puede ocurrir tras importar un esquema de API inusualmente grande—, Restorm le avisa claramente de que es demasiado grande para guardarlo, en vez de bloquearse o fallar en silencio.
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
- **Los informes de fallos vuelven a llegarnos.** Con el envío de informes activado, 1.0.0 no enviaba nada en silencio: un fallo que sufría no nos decía nada.
- **La ilustración de «lenguajes de código» vuelve a mostrar sus logotipos.**

## v1.0.0

**Restorm 1.0 — el cliente de API local-first, ya disponible.**

Restorm es un cliente de escritorio rápido y offline-first para probar y ejecutar APIs en todos los protocolos principales.

- **Protocolos**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Escenarios**: encadene solicitudes de forma visual, ramifique/itere, extraiga y reutilice valores, ejecute sin interfaz en CI.
- **Entornos y variables**: `{{handlebars}}` en todas partes, secretos tipados, entornos por carpeta.
- **Importación/Exportación**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, exportación de código.
- **Proyectos nativos de Git**: su proyecto `.restorm` es un archivo sencillo: versiónelo, compárelo y resuelva conflictos en la app.
- **Local-first y privado**: todo se ejecuta en su máquina; un cortafuegos de salida controla cada llamada externa.
- **Multiplataforma**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edición Community gratuita, con Pro y Enterprise para equipos.
