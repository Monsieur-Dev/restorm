# Changelog

## v1.0.4

**Un accesso, tutte le finestre.**

- **Il tuo account ora ti segue da una finestra all'altra.** Accedi, esci o cambia piano in una finestra di Restorm e tutte le altre finestre aperte lo adottano all'istante — senza riavvio, senza un secondo accesso. E quando completi un accesso dal browser, la conferma arriva ora alla finestra che l'aveva richiesta, anche con più finestre aperte.

Correzioni:

- **I nodi di codice ripartono sui Mac Intel** — la build macOS Intel includeva un binario esbuild compilato per Apple Silicon.
- **L'azione «Nuova finestra» del launcher AppImage apre di nuovo una finestra**, e il comando `restorm` installato dai pacchetti .deb/.rpm funziona di nuovo.
- **L'avvio su Windows è più pulito** — la finestra si carica ora tramite il protocollo dell'app, senza ripiego silenzioso dopo un errore interno a ogni avvio.

## v1.0.3

**Restorm gira in CI, senza FUSE.**

- **`restorm-cli` ora funziona sui runner di CI e nei container.** La build Linux viene scompattata invece che montata: FUSE, che Ubuntu non fornisce più, non serve più.

## v1.0.2

**I suoi token CLI/CI, senza uscire dall'applicazione.**

- **Crei, consulti e revochi i token da Restorm** — per gli utenti Pro ed Enterprise, dal pulsante account nella barra del titolo. Niente più andata e ritorno al pannello per ottenere un token della pipeline che sta scrivendo.
- **I token possono scadere.** Scelga una durata alla creazione: da 7 a 365 giorni, oppure senza scadenza come prima. Un token scaduto viene rifiutato come uno revocato.
- **La sua organizzazione può delegare.** Un amministratore può consentire a un membro preciso di creare token e, separatamente, dargli accesso al registro di audit, senza renderlo amministratore.
- **Restorm ora si installa da npm.** `npm i -g restorm-cli`, poi `restorm`: l'applicazione si avvia su Linux, macOS e Windows senza alcun programma di installazione. La build viene scaricata una sola volta, verificata con il checksum pubblicato e messa in cache, così una pipeline non la riscarica a ogni job.

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
