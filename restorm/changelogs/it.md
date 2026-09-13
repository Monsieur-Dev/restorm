# Changelog

## v1.2.0

**Registri una pagina web, ottenga la sua API in forma di richieste.**

- **Sessioni di registrazione.** Un nuovo tipo di elemento della barra laterale apre una pagina web nel mini browser integrato e acquisisce ogni chiamata API che effettua — REST, GraphQL, gRPC-web e WebSocket — in tempo reale, con liste bianca e nera in espressioni regolari, pausa e interruzione dalla barra dell'indirizzo e un badge rosso «in onda» finché è in corso. Ogni chiamata acquisita si legge esattamente come la risposta di una richiesta (corpo, informazioni, cookie, grafico); il menu contestuale di una chiamata aggiunge il suo url a una lista, con la possibilità di sfoltire ciò che era già stato acquisito. Le acquisizioni restano in memoria, limitate da una nuova impostazione dell'app, e non toccano mai il file di progetto.
- **Deduci le route (Pro).** Un pulsante trasforma le acquisizioni in un albero di cartelle di vere richieste rieseguibili: i segmenti di percorso variabili diventano parametri di percorso `{{param}}`, le cartelle seguono i prefissi statici, le chiamate gRPC-web vengono ordinate per servizio e ogni richiesta è precompilata a partire dall'ultima chiamata riuscita, con le chiamate acquisite nella sua cronologia delle risposte. Dedurre di nuovo fonde i risultati — le Sue modifiche vengono conservate.
- **La piloti dal Suo assistente IA.** Dieci strumenti MCP creano e configurano le sessioni, avviano e interrompono una registrazione, leggono le acquisizioni e deducono le route.
- **Condivida la Sua posizione con il mini browser (su richiesta).** Una nuova impostazione Privacy, disattivata per impostazione predefinita, consente alle pagine aperte nel browser integrato — durante una registrazione o meno — di leggere la Sua posizione approssimativa, come farebbe la funzione di localizzazione del sito in un browser normale. Attivarla chiede prima il Suo consenso; la posizione proviene dal servizio di localizzazione del sistema (GeoClue su Linux), altrimenti da una stima a livello di città basata sul Suo indirizzo IP. Disattivarla dimentica subito la posizione.
- **Scheda Risposta più ricca.** Le immagini ora si mostrano in linea, video e audio si riproducono, il Markdown viene renderizzato e l'editor di codice sceglie il linguaggio dal Content-Type — con un pulsante Scarica tradotto, sempre a portata di mano. Una risposta binaria rieseguita dalla cronologia non mostra più il suo base64.
- **Gli elenchi lunghi restano veloci.** L'elenco delle acquisizioni (e la barra laterale oltre le 400 righe) renderizza soltanto ciò che è sullo schermo.
- I file di progetto che contengono una sessione di registrazione vengono salvati nel formato 1.2; le versioni precedenti di Restorm Le chiedono di aggiornare prima di aprirli.

## v1.1.4

**Colleghi il suo assistente IA su macOS — ora in modo affidabile.**

- **Corretto: Claude Desktop e Cursor su macOS.** Collegare un assistente IA caricava gli strumenti di Restorm, ma poi ogni chiamata falliva con «nessuna istanza in esecuzione», anche con Restorm aperto — l'app e il connettore si cercavano in cartelle temporanee diverse. Ora si trovano in modo affidabile, qualunque cosa abbia avviato il connettore.
- **Formulazione formale in italiano, polacco e finlandese.** L'interfaccia ora si rivolge a Lei con il registro formale in queste tre lingue, in coerenza con il resto.
- **Azione Code negli scenari — più ordinata, con esempi integrati.** Il nodo Code non si allarga più quando lo script è lungo e il suo editor guadagna una scheda **Serve aiuto?** che mostra un esempio pronto all'uso nel linguaggio scelto (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Incollare con l'editor aperto non lascia più un nodo Code vagante sull'area di lavoro.
- **Individui i problemi di progettazione nelle sue API importate.** Dopo aver importato un'API — o alla riapertura di un file — Restorm controlla con discrezione ogni API alla ricerca di problemi strutturali (rotte duplicate, risposte mancanti, percorsi in conflitto con il Mock Server…), la segnala nella barra laterale con un «!» e aggiunge una scheda «Problemi» che elenca ogni problema e le rotte esattamente interessate, con ogni rotta espandibile fino alla sua documentazione.

## v1.1.3

**Colleghi il suo assistente IA a Restorm.**

- **Con un clic, dall'app.** Il menu MCP nella barra di stato offre ora «Aggiunga Restorm al suo assistente IA» — una configurazione pronta da incollare per Claude Code, Claude Desktop e Cursor, più un «Aggiunga a Claude Code» con un clic.
- **Oppure una riga, ovunque.** Punti un qualsiasi client MCP sul suo Restorm in esecuzione con `npx -y restorm-mcp` — il ponte lo trova da solo, senza porta né token da copiare.
- **Un plugin per Claude Code.** Esegua `/plugin marketplace add Monsieur-Dev/restorm`, poi installi il plugin `restorm`.

Veda [Collegare il suo assistente IA](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Supporto per OpenAPI 3.2.**

- **Importi specifiche OpenAPI 3.2.** Il metodo `QUERY`, i verbi personalizzati (`additionalOperations`), il parametro query string e i media in streaming vengono importati come richieste pronte all'uso.
- **Sfogli un file da importare.** Un pulsante Sfoglia nella finestra di importazione apre un selettore di file nativo — niente più digitare o trascinare un percorso.
- **Vista divisa per incolla di grandi dimensioni.** Incollando una specifica su più righe si apre un editor di codice a sinistra e l'anteprima a destra, con un divisore regolabile.
- **Importazione tollerante.** Una specifica con qualche `$ref` rotto importa tutte le rotte possibili e mostra un avviso con ciò che ha dovuto ignorare.

Correzioni:

- Importare una specifica non valida o irraggiungibile mostra un messaggio chiaro invece di aprire la finestra di segnalazione di crash.
- La vista dettagliata della segnalazione di crash torna a scorrere.
- Gli sfondi delle finestre non sono più sfocati.

## v1.1.1

**Il designer di API ora si pilota dalla barra laterale.**

- **I suoi modelli, enum e route vivono nella barra laterale.** Le tre liste nelle schede spariscono: i modelli (con l'annidamento per ereditarietà), gli enum e le route (gruppi e relative route) sono ora direttamente nell'albero della barra laterale. Con il tasto destro può rinominare, aggiungere un sotto-modello o un sotto-gruppo, clonare una route, generare il CRUD o eliminare; trascini per riordinare o riassegnare il genitore, mai fuori dal design. Ogni pagina mostra ora solo il dettaglio dell'elemento selezionato.
- **Una panoramica di modelli, enum e route.** Il nodo radice di ogni sezione elenca ora tutto ciò che contiene — e i Modelli aggiungono una scheda **Grafico**: un diagramma delle classi dei suoi modelli con ereditarietà e riferimenti. Gli enum mostrano i loro valori accanto al nome.
- **Un unico posto per rinominare.** Un modello, un enum o una route si rinomina dal titolo grande (la matita), e un nome vuoto mostra **«<senza nome>»** così la matita resta sempre raggiungibile — il nome non appare più due volte nella pagina.
- **Gli errori di validazione indicano l'elemento.** Quando qualcosa non va — un modello e un enum con lo stesso nome, un riferimento a qualcosa che non esiste più — una nota in cima al modello, enum o route lo spiega.
- **Un percorso di navigazione completo.** La traccia rispecchia l'intera gerarchia della barra laterale — cartelle › design › sezione › gruppo › elemento — e ogni segmento è cliccabile.
- **Ne selezioni molti, elimini in una volta.** Selezioni più modelli, enum o route e li elimini in un colpo solo, dopo una conferma.
- **Copi o apra la sorgente di un template di codice con un clic.** Nella pagina «</> Code», al passaggio del mouse su un template compaiono un pulsante per copiarne l'URL o il percorso e uno per aprirlo: il repository nel browser, o la cartella sul disco per un template locale.
- **Le nuove route partono con un nome.** Una route creata da zero riceve ora un nome predefinito, così può rinominarla subito.
- **Schede di anteprima, come nel suo editor.** Un solo clic apre ora un elemento in una scheda di **anteprima** riutilizzabile (il nome in corsivo); cliccare un altro elemento riutilizza la stessa scheda invece di impilarne una nuova. Un doppio clic, qualsiasi modifica o l'esecuzione di una richiesta la rende permanente. Disattivabile in Impostazioni › Comportamento.
- **Fissi le schede che tiene aperte.** Faccia clic destro su una scheda e la fissi: le schede fissate restano in testa, sopravvivono a «chiuda le altre» e vengono ricordate per progetto.
- **Gli ambienti hanno una vera vista di dettaglio.** Apra un ambiente per rinominarlo dal suo titolo, impostarne icona e colore e aggiungere un sotto-ambiente — e il menu contestuale ora duplica un ambiente con tutte le sue variabili e i suoi sotto-ambienti.

Correzioni:

- **Scegliere un template di codice chiude la libreria.** «Usi» ora le riporta direttamente alla pagina Code.
- **La generazione della documentazione non fallisce più sui campi opzionali.** Generare la documentazione da un design il cui modello o parametro lasciava «required» non impostato non si interrompe più con un errore di template.
- **L'eliminazione di un enum chiede conferma.** Gli enum ricevono la stessa conferma di modelli e route.
- **La barra laterale rivela ciò che seleziona.** Con «sincronizzi la barra laterale con la scheda attiva» attivo, selezionare o creare un modello, enum o route espande i suoi genitori per tenerlo visibile nell'albero.
- **Il pulsante dell'ambiente resta leggibile su qualsiasi colore.** La sua etichetta passa ora a testo chiaro o scuro per restare leggibile sul colore dell'ambiente, come il pulsante di esecuzione.
- **Il clic centrale chiude un file aperto.** Fare clic centrale su una voce dell'elenco «Aperti» nella barra laterale ne chiude la scheda — e una nuova impostazione di Comportamento consente di nascondere del tutto quel pannello.
- **Formulazione più chiara partendo dalla documentazione.** Nella documentazione di un'API importata, il pulsante ora recita «Crei una nuova richiesta da questa documentazione».
- **L'accesso funziona nella versione Microsoft Store.** La callback a protocollo personalizzato che il browser restituisce dopo il login è ora dichiarata nel pacchetto Store, così l'accesso si completa invece di andare in timeout.

## v1.1.0

🎉 **Restorm ora è anche un designer di API.** Progetti la sua API, la serva come mock live su cinque protocolli alla volta e ne generi i client — tutto senza uscire dall'app, tutto sul suo disco.

- **Un designer di API visuale.** Modelli la sua API a mano — modelli, enum (con nome o inline), rotte, parametri, esempi con nome, vincoli, tag e deprecazioni — senza scrivere una sola riga di specifica.
- **La serva come mock, con un clic, su 5 protocolli contemporaneamente.** Il progetto diventa un server che risponde in HTTP, GraphQL, SOAP, OData e gRPC simultaneamente. Le risposte provengono dai suoi esempi con nome (o da dati realistici generati dai suoi modelli), con validazione dei vincoli, latenza simulata e una modalità stateful.
- **Client pronti all'uso, generati automaticamente.** Mentre il mock è in esecuzione, la sezione Clients crea richieste reali ed eseguibili per ogni protocollo abilitato, puntate agli endpoint del mock. Un clic apre una richiesta e colpisce il server — niente più reimportazioni della sua API altrove per testarla.
- **Generi codice** dal suo progetto usando i template forniti e i suoi template personalizzati, reso in una sandbox e scritto su disco solo dopo la sua conferma. **Esporti anche il descrittore** (OpenAPI e altri).
- **All'importazione, i corpi delle richieste si precompilano**: GraphQL seleziona i campi scalari del tipo di ritorno, gRPC espande i messaggi annidati — la richiesta parte così com'è.

## v1.0.6

Correzioni:

- **Un progetto molto grande ora fallisce il salvataggio con un messaggio chiaro anziché bloccarsi.** Se un progetto diventa troppo grande per essere scritto su disco in un unico blocco — cosa che può accadere dopo aver importato uno schema di API insolitamente grande — Restorm La avvisa chiaramente che è troppo grande da salvare, invece di andare in crash o fallire in silenzio.
- **Segnalazione degli errori più chiara dietro le quinte.** L'annullamento della finestra «Salva con nome» non viene più registrato come errore e un'importazione fallita ora riporta la causa reale, così i problemi veri sono più facili da individuare e correggere.

## v1.0.5

**Cookie jar — un contenitore di cookie per ogni ambiente.**

- **Ogni ambiente conserva i propri cookie.** Acceda alla sua API di sviluppo e alla sua API di produzione da due ambienti diversi: le loro sessioni non si incrociano mai — un cookie catturato in uno viene rimandato solo in quello. Scadenza, `Path`, `Domain` e sottodomini, `Secure`, `HttpOnly` e `SameSite` ora vengono rispettati, non scartati.
- **Ecco il Cookie jar.** Una nuova scheda del workbench — **Visualizza ▸ Cookie jar** — elenca i cookie di ogni ambiente raggruppati per dominio in pannelli comprimibili: modifichi un valore, ne elimini uno, svuoti un dominio o l'intero contenitore, oppure aggiunga un cookie a mano. Si aggiorna in diretta man mano che le sue richieste impostano cookie.
- **Guardi cosa ha inviato e ricevuto ogni richiesta.** Ogni richiesta ha ora una scheda **Cookie** accanto a Risposta e Info, che mostra i cookie inviati con la chiamata e i cookie ricevuti in risposta — compresi i cookie impostati su un reindirizzamento che non raggiungono mai la risposta finale. C'è anche sulle risposte passate nella sua cronologia.
- **I login con i cookie funzionano e basta.** Una richiesta che restituisce `Set-Cookie` viene catturata e ritrasmessa automaticamente nelle chiamate protette che seguono — anche durante l'esecuzione di uno scenario, dove ogni passaggio condivide il contenitore dell'ambiente.
- **I cookie persistono come in un browser.** I cookie con una scadenza vengono salvati per progetto e ricaricati quando lo riapre; i cookie di sessione vengono scartati al riavvio — esattamente come farebbe un browser.
- **Oltre il REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC e SSE ora inviano e memorizzano tutti i cookie, mentre WebSocket li trasporta nell'handshake di connessione.
- **I cookie possono usare le sue variabili.** Digiti `{{token}}` in un cookie che aggiunge a mano e verrà risolto in base all'ambiente attivo quando la richiesta parte.

Correzioni:

- **Il salvataggio automatico ora copre gli ambienti dentro le cartelle.** L'aggiunta o la ridenominazione di un sotto-ambiente viene salvata subito in modalità salvataggio automatico — niente più richiesta «salvare prima di chiudere?» per una modifica che doveva già stare su disco.

## v1.0.4

**Un accesso, tutte le finestre.**

- **Il suo account ora La segue da una finestra all'altra.** Acceda, esca o cambi piano in una finestra di Restorm e tutte le altre finestre aperte lo adottano all'istante — senza riavvio, senza un secondo accesso. E quando completa un accesso dal browser, la conferma arriva ora alla finestra che l'aveva richiesta, anche con più finestre aperte.

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
- **Le segnalazioni di crash ci arrivano di nuovo.** Con l'invio attivo, la 1.0.0 non inviava nulla in silenzio: un crash che incontrava non ci diceva niente.
- **L'illustrazione «linguaggi di codice» mostra di nuovo i suoi loghi.**

## v1.0.0

**Restorm 1.0 — il client API local-first, ora disponibile.**

Restorm è un client desktop veloce e offline-first per testare e pilotare API su tutti i principali protocolli.

- **Protocolli**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scenari**: concateni richieste visivamente, dirami/ripeta in loop, estragga e riutilizzi valori, esegua headless in CI.
- **Ambienti e variabili**: `{{handlebars}}` ovunque, secret tipizzati, ambienti per cartella.
- **Import/Export**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, esportazione di codice.
- **Progetti Git-nativi**: il suo progetto `.restorm` è un semplice file — lo versioni, lo confronti e risolva i conflitti nell'app.
- **Local-first e privato**: tutto viene eseguito sul suo computer; un firewall in uscita controlla ogni chiamata esterna.
- **Multipiattaforma**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edizione Community gratuita, con Pro ed Enterprise per i team.
