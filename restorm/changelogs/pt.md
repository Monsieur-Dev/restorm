# Changelog

## v1.0.2

**Os seus tokens CLI/CI, sem sair da aplicação.**

- **Crie, veja e revogue os seus tokens a partir do Restorm** — para utilizadores Pro e Enterprise, a partir do botão de conta na barra de título. Acabou a ida ao painel para obter um token do pipeline que está a escrever.
- **Os tokens podem expirar.** Escolha uma duração ao criá-los: 7 a 365 dias, ou sem expiração como antes. Um token expirado é recusado tal como um revogado.
- **A sua organização pode delegar.** Um administrador pode permitir que um membro específico crie tokens e, separadamente, dar-lhe acesso ao registo de auditoria, sem o tornar administrador.
- **O Restorm agora instala-se a partir do npm.** `npm i -g restorm-cli` e depois `restorm`: a aplicação abre no Linux, macOS e Windows sem instalador. A compilação é transferida uma única vez, verificada pela soma de verificação publicada e guardada em cache, para que um pipeline deixe de a transferir em cada tarefa.

## v1.0.1

**Primeiro patch: mover itens na barra lateral, nomes de separadores e relatórios de falhas.**

- **Mover um item na barra lateral já não quebra a aplicação.** Com o mini-navegador, as Definições ou os registos MCP abertos, arrastar qualquer linha da barra lateral destruía a interface e só um reinício a recuperava.
- **Renomear um item passa a atualizar todos os separadores abertos** — incluindo os de um painel dividido e os de qualquer tipo de pedido (gRPC, GraphQL, Redis…), que mantinham o nome antigo até serem reabertos.
- **Os relatórios de falhas voltam a chegar-nos.** Com o envio ativado, a 1.0.0 não enviava nada em silêncio: uma falha que encontrasse não nos dizia nada.
- **A ilustração «linguagens de código» volta a mostrar os seus logótipos.**

## v1.0.0

**Restorm 1.0 — o cliente de API local-first, lançado.**

O Restorm é um cliente de desktop rápido e offline-first para testar e executar APIs em todos os principais protocolos.

- **Protocolos**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Cenários**: encadeie requisições visualmente, ramifique/repita em loop, extraia e reutilize valores, execute headless em CI.
- **Ambientes e variáveis**: `{{handlebars}}` em todo lugar, segredos tipados, ambientes por pasta.
- **Importação/Exportação**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, exportação de código.
- **Projetos nativos do Git**: seu projeto `.restorm` é um arquivo simples — versione, compare e resolva conflitos no próprio app.
- **Local-first e privado**: tudo é executado na sua máquina; um firewall de saída controla cada chamada externa.
- **Multiplataforma**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edição Community gratuita, com Pro e Enterprise para equipes.
