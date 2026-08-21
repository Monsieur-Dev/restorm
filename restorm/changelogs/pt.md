# Changelog

## v1.0.5

**Cookies, feitos como deve ser — um frasco por ambiente.**

- **Cada ambiente mantém os seus próprios cookies.** Inicie sessão na sua API de desenvolvimento e na sua API de produção a partir de dois ambientes e as sessões nunca se cruzam — um cookie capturado num só volta a ser enviado apenas nesse mesmo. A validade, o `Path`, o `Domain` e os subdomínios, `Secure`, `HttpOnly` e `SameSite` passam a ser respeitados, em vez de descartados.
- **Veja e edite o que está guardado.** Um novo Gestor de Cookies — **Ver → Cookies** — lista os cookies de cada ambiente agrupados por origem: edite um valor, elimine um, limpe uma origem ou o frasco inteiro, ou adicione um cookie manualmente. Quando uma resposta define cookies, um selo 🍪 na resposta abre o gestor diretamente nessa origem.
- **Os inícios de sessão por cookie simplesmente funcionam.** Um pedido que devolve `Set-Cookie` é capturado e reproduzido automaticamente nas chamadas protegidas que se seguem — incluindo ao longo da execução de um cenário, onde cada passo partilha o frasco do ambiente.
- **Para além do REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC e SSE passam a enviar e a guardar cookies, e o WebSocket, o Socket.IO e o STOMP transportam-nos no handshake da ligação.
- **Os cookies podem usar as suas variáveis.** Escreva `{{token}}` num cookie que adicione manualmente e este é resolvido em relação ao ambiente ativo quando o pedido é enviado.

## v1.0.4

**Inicie sessão uma vez — todas as janelas acompanham.**

- **A sua conta agora acompanha-o entre janelas.** Inicie sessão, termine-a ou mude de plano numa janela do Restorm e todas as outras janelas abertas adotam-no de imediato — sem reiniciar, sem segunda autenticação. E ao concluir uma autenticação no navegador, a confirmação chega agora à janela que a pediu, mesmo com várias janelas abertas.

Correções:

- **Os nós de código voltam a arrancar nos Mac Intel** — a build macOS Intel incluía um binário esbuild compilado para Apple Silicon.
- **A ação «Nova janela» do lançador AppImage volta a abrir uma janela**, e o comando `restorm` instalado pelos pacotes .deb/.rpm volta a funcionar.
- **O arranque no Windows está mais limpo** — a janela carrega agora através do protocolo da aplicação, sem recurso silencioso após um erro interno em cada arranque.

## v1.0.3

**O Restorm corre em CI, sem FUSE.**

- **O `restorm-cli` funciona agora em runners de CI e em contentores.** A compilação Linux é descompactada em vez de montada: o FUSE, que o Ubuntu já não inclui, deixou de ser necessário.

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
