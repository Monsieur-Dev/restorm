# Changelog

## v1.0.1

**Prima patch: spostamenti nella barra laterale, nomi delle schede e segnalazioni di crash.**

- **Spostare un elemento nella barra laterale non blocca più l'app.** Con il mini browser, le Impostazioni o i log MCP aperti, trascinare una riga qualsiasi della barra laterale distruggeva l'interfaccia e solo un riavvio la ripristinava.
- **Rinominare un elemento ora aggiorna tutte le schede aperte**, comprese quelle in un riquadro diviso e quelle di ogni tipo di richiesta (gRPC, GraphQL, Redis…), che mantenevano il vecchio nome fino alla riapertura.
- **Le segnalazioni di crash ci arrivano di nuovo.** Con l'invio attivo, la 1.0.0 non inviava nulla in silenzio: un crash che incontravi non ci diceva niente.
- **L'illustrazione «linguaggi di codice» mostra di nuovo i suoi loghi.**

## v1.0.0

**Restorm 1.0 — il client API local-first, ora disponibile.**

Restorm è un client desktop veloce e offline-first per testare e pilotare API su tutti i principali protocolli.

- **Protocolli**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenari**: concatena richieste visivamente, dirama/ripeti in loop, estrai e riutilizza valori, esegui headless in CI.
- **Ambienti e variabili**: `{{handlebars}}` ovunque, secret tipizzati, ambienti per cartella.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, esportazione di codice.
- **Progetti Git-nativi**: il tuo progetto `.restorm` è un semplice file — versionalo, confrontalo e risolvi i conflitti nell'app.
- **Local-first e privato**: tutto viene eseguito sul tuo computer; un firewall in uscita controlla ogni chiamata esterna.
- **Multipiattaforma**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edizione Community gratuita, con Pro ed Enterprise per i team.
