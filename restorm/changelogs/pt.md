# Changelog

## v1.2.0

**Grave uma página web e obtenha a sua API em pedidos.**

- **Sessões de gravação.** Um novo tipo de elemento da barra lateral abre uma página web no mini-navegador integrado e captura cada chamada API que ela efetua — REST, GraphQL, gRPC-web e WebSocket — em direto, com listas branca e negra em expressões regulares, pausa e paragem a partir da barra de endereço, e um emblema vermelho «no ar» enquanto decorre. Cada chamada capturada lê-se exatamente como a resposta de um pedido (corpo, informações, cookies, grafo); o menu de contexto de uma chamada adiciona o seu url a uma lista, com a possibilidade de limpar o que já tinha sido capturado. As capturas ficam em memória, limitadas por uma nova definição da aplicação, e nunca tocam no seu ficheiro de projeto.
- **Deduzir as rotas (Pro).** Um botão transforma as capturas numa árvore de pastas de verdadeiros pedidos que pode voltar a executar: os segmentos de caminho que variam tornam-se parâmetros de caminho `{{param}}`, as pastas seguem os prefixos estáticos, as chamadas gRPC-web são arrumadas por serviço e cada pedido é pré-preenchido a partir da última chamada bem-sucedida, com as chamadas capturadas no seu histórico de respostas. Deduzir de novo funde os resultados — as suas alterações são conservadas.
- **Controle-a a partir do seu assistente de IA.** Dez ferramentas MCP criam e configuram sessões, iniciam e param uma gravação, leem as capturas e deduzem as rotas.
- **Separador Resposta mais rico.** As imagens passam a aparecer em linha, os vídeos e o áudio reproduzem-se, o Markdown é renderizado e o editor de código escolhe a linguagem a partir do Content-Type — com um botão Transferir traduzido, sempre à mão. Uma resposta binária voltada a executar a partir do histórico já não mostra o seu base64.
- **As listas longas continuam rápidas.** A lista das capturas (e a barra lateral acima de 400 linhas) só renderiza o que está no ecrã.
- Os ficheiros de projeto que contêm uma sessão de gravação são guardados no formato 1.2; as versões anteriores do Restorm pedem-lhe para atualizar antes de os abrir.

## v1.1.4

**Ligue o seu assistente de IA no macOS — agora fiável.**

- **Correção: Claude Desktop e Cursor no macOS.** Ligar um assistente de IA carregava as ferramentas do Restorm, mas depois cada chamada falhava com «nenhuma instância em execução», mesmo com o Restorm aberto — a aplicação e o conector procuravam-se em pastas temporárias diferentes. Agora encontram-se de forma fiável, seja lá o que tenha iniciado o conector.
- **Formulação formal em italiano, polaco e finlandês.** A interface passa a tratá-lo pela forma formal nestes três idiomas, em coerência com o resto.
- **Ação Code nos cenários — mais limpa, com exemplos integrados.** O nó Code já não se estica quando o script é longo, e o seu editor ganha um separador **Precisa de ajuda?** que mostra um exemplo pronto a executar na linguagem que escolher (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Colar com o editor aberto já não deixa um nó Code perdido na tela.
- **Detete problemas de design nas suas API importadas.** Após importar uma API — ou ao reabrir um ficheiro — o Restorm verifica discretamente cada API em busca de problemas estruturais (rotas duplicadas, respostas em falta, caminhos em conflito com o Mock Server…), assinala-a na barra lateral com um «!» e adiciona um separador «Problemas» que lista cada problema e as rotas exatamente afetadas, podendo cada rota ser expandida para a respetiva documentação.

## v1.1.3

**Ligue o seu assistente de IA ao Restorm.**

- **Com um clique, a partir da aplicação.** O menu MCP na barra de estado passa a oferecer «Adicionar o Restorm ao seu assistente de IA» — uma configuração pronta a colar para o Claude Code, o Claude Desktop e o Cursor, além de um «Adicionar ao Claude Code» com um clique.
- **Ou uma linha, em qualquer lugar.** Aponte qualquer cliente MCP para o seu Restorm em execução com `npx -y restorm-mcp` — a ponte encontra-o sozinha, sem porta nem token para copiar.
- **Um plugin para o Claude Code.** Execute `/plugin marketplace add Monsieur-Dev/restorm` e depois instale o plugin `restorm`.

Consulte [Ligar o seu assistente de IA](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Suporte a OpenAPI 3.2.**

- **Importe especificações OpenAPI 3.2.** O método `QUERY`, os verbos personalizados (`additionalOperations`), o parâmetro de query string e os tipos de mídia em streaming são importados como requisições prontas a executar.
- **Procure um ficheiro para importar.** Um botão Procurar na janela de importação abre um seletor de ficheiros nativo — sem mais digitar ou arrastar um caminho.
- **Vista dividida para colagens grandes.** Colar uma especificação com várias linhas abre um editor de código à esquerda e a pré-visualização à direita, com um separador ajustável.
- **Importação tolerante.** Uma especificação com alguns `$ref` partidos importa todas as rotas que consegue e mostra um aviso com o que teve de ignorar.

Correções:

- Importar uma especificação inválida ou inacessível mostra uma mensagem clara em vez de abrir a janela de relatório de falha.
- A vista de detalhe do relatório de falha volta a fazer scroll.
- Os fundos das janelas já não são desfocados.

## v1.1.1

**O designer de API agora é controlado pela barra lateral.**

- **Os seus modelos, enums e rotas vivem na barra lateral.** As três listas dos separadores desaparecem: os modelos (com o seu aninhamento por herança), os enums e as rotas (grupos e as suas rotas) ficam agora diretamente na árvore da barra lateral. Clique com o botão direito para renomear, adicionar um submodelo ou um subgrupo, clonar uma rota, gerar o CRUD ou eliminar; arraste para reordenar ou reatribuir o pai — nunca para fora do design. Cada página mostra agora apenas o detalhe do item selecionado.
- **Uma visão geral dos seus modelos, enums e rotas.** O nó raiz de cada seção agora lista tudo o que contém — e os Modelos ganham uma aba **Gráfico**: um diagrama de classes dos seus modelos com a herança e as referências. Os enums mostram os seus valores ao lado do nome.
- **Um único lugar para renomear.** Um modelo, enum ou rota é renomeado a partir do seu título grande (o lápis), e um nome vazio mostra **«<sem nome>»** para que o lápis permaneça sempre acessível — o nome já não aparece duas vezes na página.
- **Os erros de validação apontam para o elemento.** Quando algo está errado — um modelo e um enum a partilhar um nome, uma referência a algo que já não existe — uma nota no topo do modelo, enum ou rota explica-o.
- **Um caminho de navegação completo.** O rasto reflete toda a hierarquia da barra lateral — pastas › design › seção › grupo › elemento — e cada segmento é clicável.
- **Selecione vários, exclua de uma vez.** Selecione vários modelos, enums ou rotas e exclua-os de uma só vez, após uma confirmação.
- **Copie ou abra a fonte de um template de código com um clique.** Na página «</> Code», ao passar o rato sobre um template surge um botão para copiar o seu URL ou caminho e outro para o abrir: o repositório no navegador, ou a pasta no disco para um template local.
- **As rotas novas começam com um nome.** Uma rota criada do zero recebe agora um nome por omissão, portanto pode renomeá-la de imediato.
- **Separadores de pré-visualização, como no seu editor.** Um único clique abre agora um item num separador de **pré-visualização** reutilizável (o nome em itálico); clicar noutro item reutiliza o mesmo separador em vez de empilhar um novo. Um duplo clique, qualquer edição ou a execução de um pedido mantém-no aberto de vez. Desative em Definições › Comportamento.
- **Fixe os separadores que mantém abertos.** Clique com o botão direito num separador e fixe-o: os separadores fixados ficam à frente, sobrevivem a «fechar os outros» e são memorizados por projeto.
- **Os ambientes ganham uma verdadeira vista de detalhe.** Abra um ambiente para o renomear a partir do seu título, definir o seu ícone e cor e adicionar um subambiente — e o menu do botão direito duplica agora um ambiente com todas as suas variáveis e subambientes.

Correções:

- **Escolher um template de código fecha a biblioteca.** «Usar» leva-o agora diretamente de volta à página Code.
- **A geração de documentação já não falha em campos opcionais.** Gerar a documentação de um design cujo modelo ou parâmetro deixava «required» por definir já não para com um erro de template.
- **Excluir um enum pede confirmação.** Os enums recebem a mesma confirmação que os modelos e as rotas.
- **A barra lateral revela o que você seleciona.** Com «sincronizar a barra lateral com a aba ativa» ativado, selecionar ou criar um modelo, enum ou rota expande os seus pais para o manter visível na árvore.
- **O botão de ambiente mantém-se legível sobre qualquer cor.** O seu texto passa agora a claro ou escuro para se manter legível sobre a cor do ambiente, tal como o botão de execução.
- **O clique do meio fecha um ficheiro aberto.** Clicar com o botão do meio numa entrada da lista «Abertos» da barra lateral fecha o seu separador — e uma nova definição de Comportamento permite ocultar totalmente esse painel.
- **Texto mais claro ao partir da documentação.** Na documentação de uma API importada, o botão apresenta agora «Criar um novo pedido a partir desta documentação».
- **O início de sessão funciona na versão da Microsoft Store.** A chamada de retorno de protocolo personalizado que o navegador devolve após o início de sessão está agora declarada no pacote da Store, pelo que o início de sessão termina em vez de expirar.

## v1.1.0

🎉 **O Restorm agora também é um designer de API.** Desenhe a sua API, sirva-a como um mock ao vivo em cinco protocolos ao mesmo tempo e gere os seus clientes — tudo sem sair da app, tudo no seu próprio disco.

- **Um designer de API visual.** Modele a sua API à mão — modelos, enums (nomeados ou inline), rotas, parâmetros, exemplos nomeados, restrições, tags e depreciações — sem escrever uma única linha de especificação.
- **Sirva-a como mock, num clique, em 5 protocolos ao mesmo tempo.** O design torna-se um servidor que responde em HTTP, GraphQL, SOAP, OData e gRPC simultaneamente. As respostas vêm dos seus exemplos nomeados (ou de dados realistas gerados a partir dos seus modelos), com validação de restrições, latência simulada e um modo stateful.
- **Clientes prontos a executar, gerados automaticamente.** Enquanto o mock corre, a secção Clients cria pedidos reais e executáveis para cada protocolo ativado, apontados aos endpoints do mock. Um clique abre um pedido e atinge o servidor — acabou reimportar a sua API noutro lado para a testar.
- **Gere código** a partir do seu design usando os templates fornecidos e os seus próprios templates personalizados, renderizado numa sandbox e escrito no disco apenas depois de confirmar. **Exporte também o descritor** (OpenAPI e outros).
- **Ao importar, os corpos dos pedidos são pré-preenchidos**: o GraphQL seleciona os campos escalares do tipo de retorno, o gRPC expande as mensagens aninhadas — o pedido corre tal como está.

## v1.0.6

Correções:

- **Um projeto muito grande agora falha ao guardar com uma mensagem clara em vez de bloquear.** Se um projeto ficar grande demais para ser gravado no disco de uma só vez — o que pode acontecer depois de importar um esquema de API invulgarmente grande — o Restorm avisa-o claramente de que é grande demais para guardar, em vez de estoirar ou falhar em silêncio.
- **Relato de erros mais claro nos bastidores.** Cancelar a caixa «Guardar como» já não é registado como erro, e uma importação falhada passa a indicar a sua causa real — assim os problemas verdadeiros são mais fáceis de detetar e corrigir.

## v1.0.5

**O Cookie jar — um frasco de cookies por ambiente.**

- **Cada ambiente mantém os seus próprios cookies.** Inicie sessão na sua API de desenvolvimento e na sua API de produção a partir de dois ambientes e as sessões nunca se cruzam — um cookie capturado num só volta a ser enviado apenas nesse mesmo. A validade, o `Path`, o `Domain` e os subdomínios, `Secure`, `HttpOnly` e `SameSite` passam a ser respeitados, em vez de descartados.
- **Conheça o Cookie jar.** Um novo separador do plano de trabalho — **Ver ▸ Cookie jar** — lista os cookies de cada ambiente agrupados por domínio em painéis recolhíveis: edite um valor, elimine um, limpe um domínio ou o frasco inteiro, ou adicione um cookie manualmente. Atualiza-se em direto à medida que os seus pedidos definem cookies.
- **Veja o que cada pedido enviou e recebeu.** Cada pedido tem agora um separador **Cookies** ao lado de Resposta e Informações, que mostra os cookies enviados com a chamada e os cookies recebidos — incluindo os cookies definidos numa redireção que nunca chegam à resposta final. Está também presente nas respostas passadas do seu histórico.
- **Os inícios de sessão por cookie simplesmente funcionam.** Um pedido que devolve `Set-Cookie` é capturado e reproduzido automaticamente nas chamadas protegidas que se seguem — incluindo ao longo da execução de um cenário, onde cada passo partilha o frasco do ambiente.
- **Os cookies persistem como num navegador.** Os cookies com uma validade são guardados por projeto e recarregados quando o reabre; os cookies de sessão são descartados quando reinicia — exatamente como faria um navegador.
- **Para além do REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC e SSE passam a enviar e a guardar cookies, e o WebSocket transporta-os no handshake da ligação.
- **Os cookies podem usar as suas variáveis.** Escreva `{{token}}` num cookie que adicione manualmente e este é resolvido em relação ao ambiente ativo quando o pedido é enviado.

Correções:

- **A gravação automática abrange agora os ambientes dentro de pastas.** Adicionar ou renomear um subambiente é gravado de imediato no modo de gravação automática — sem mais o pedido «guardar antes de fechar?» para uma alteração que já se destinava a estar no disco.

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
