# Changelog

## v1.1.4

**Brancher votre assistant IA sur macOS — désormais fiable.**

- **Correction : Claude Desktop et Cursor sur macOS.** Brancher un assistant IA chargeait bien les outils de Restorm mais chaque appel échouait avec « aucune instance en cours », même avec Restorm ouvert — l'application et le connecteur se cherchaient dans des dossiers temporaires différents. Ils se retrouvent maintenant de façon fiable, quel que soit ce qui a lancé le connecteur.
- **Formulation vouvoyée en italien, polonais et finnois.** L'interface s'adresse désormais à vous au registre formel dans ces trois langues, en cohérence avec le reste.
- **Action Code des scénarios — plus nette, avec des exemples intégrés.** Le nœud Code ne s'étire plus quand le script est long, et son éditeur gagne un onglet **Besoin d'aide ?** qui montre un exemple prêt à l'emploi dans le langage choisi (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Coller pendant que l'éditeur est ouvert ne crée plus de nœud Code parasite sur le canevas.

## v1.1.3

**Branchez votre assistant IA sur Restorm.**

- **En un clic, depuis l'app.** Le menu MCP de la barre d'état propose désormais « Ajouter Restorm à votre assistant IA » — une configuration prête à coller pour Claude Code, Claude Desktop et Cursor, plus un « Ajouter à Claude Code » en un clic.
- **Ou en une ligne, partout.** Pointez n'importe quel client MCP vers votre Restorm en cours d'exécution avec `npx -y restorm-mcp` — le pont le trouve tout seul, sans aucun port ni jeton à copier.
- **Un plugin pour Claude Code.** Lancez `/plugin marketplace add Monsieur-Dev/restorm`, puis installez le plugin `restorm`.

Voir [Connecter votre assistant IA](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Prise en charge d'OpenAPI 3.2.**

- **Import des specs OpenAPI 3.2.** La méthode `QUERY`, les verbes personnalisés (`additionalOperations`), le paramètre de query string et les médias en streaming s'importent en requêtes prêtes à jouer.
- **Un bouton Parcourir.** La modale d'import a un bouton Parcourir qui ouvre un sélecteur de fichier natif — fini de taper ou de glisser un chemin.
- **Une vue scindée pour les gros collages.** Coller une spec sur plusieurs lignes ouvre un éditeur de code à gauche et l'aperçu à droite, avec un séparateur ajustable.
- **Un import tolérant.** Une spec avec quelques `$ref` cassés importe toutes les routes possibles et affiche un avertissement listant ce qu'elle a dû ignorer.

Corrections :

- Importer une spec invalide ou injoignable affiche un message clair au lieu d'ouvrir la fenêtre de rapport de plantage.
- La vue « voir le rapport complet » du rapport de plantage se défile de nouveau.
- Les fonds des fenêtres ne sont plus floutés.

## v1.1.1

**Le designer d'API se pilote depuis la barre latérale.**

- **Vos modèles, enums et routes vivent dans la barre latérale.** Les trois listes internes disparaissent : les modèles (avec leur héritage imbriqué), les enums et les routes (groupes et leurs routes) sont désormais directement dans l'arborescence. Un clic droit permet de renommer, ajouter un sous-modèle ou un sous-groupe, cloner une route, générer le CRUD ou supprimer ; le glisser-déposer réordonne ou reparente — jamais hors du design. Chaque page n'affiche plus que le détail de l'élément sélectionné.
- **Une vue d'ensemble de vos modèles, enums et routes.** Le nœud racine de chaque section liste désormais tout ce qu'elle contient — et les Modèles gagnent un onglet **Graphe** : un diagramme de classes de vos modèles, avec leur héritage et leurs références. Les enums affichent leurs valeurs juste à côté du nom.
- **Un seul endroit pour renommer.** Un modèle, un enum ou une route se renomme depuis son grand titre (le crayon), et un nom vide affiche **« <sans nom> »** pour que le crayon reste toujours atteignable — le nom n'apparaît plus en double sur la page.
- **Les erreurs de validation pointent l'élément.** Quand quelque chose ne va pas — un modèle et un enum qui partagent un nom, une référence vers un élément disparu — un encadré en haut du modèle, de l'enum ou de la route l'explique.
- **Un fil d'ariane complet.** Le fil reflète toute la hiérarchie de la barre latérale — dossiers › design › section › groupe › élément — et chaque segment est cliquable.
- **Sélection multiple, suppression groupée.** Sélectionnez plusieurs modèles, enums ou routes et supprimez-les d'un coup, après confirmation.
- **Copiez ou ouvrez la source d'un template de code en un clic.** Sur la page « </> Code », au survol d'un template, un bouton copie son URL ou son chemin, un autre l'ouvre — le dépôt dans votre navigateur, ou le dossier sur le disque pour un template local.
- **Une nouvelle route a désormais un nom.** Une route créée de zéro reçoit un nom par défaut, immédiatement renommable.
- **Des onglets d'aperçu, comme dans votre éditeur.** Un simple clic ouvre désormais un élément dans un onglet d'**aperçu** réutilisable (son nom en italique) ; cliquer un autre élément réutilise le même onglet au lieu d'en empiler un nouveau. Un double-clic, la moindre modification ou l'exécution d'une requête le rend permanent. Désactivable dans Paramètres › Comportement.
- **Épinglez les onglets que vous gardez ouverts.** Un clic droit sur un onglet permet de l'épingler : les onglets épinglés restent en tête, survivent à « Fermer les autres » et sont mémorisés par projet.
- **Les environnements ont une vraie vue de détail.** Ouvrez un environnement pour le renommer depuis son titre, choisir son icône et sa couleur, et ajouter un sous-environnement — et le menu contextuel duplique désormais un environnement avec toutes ses variables et ses sous-environnements.

Corrections :

- **Choisir un template ferme la bibliothèque.** Le bouton « Utiliser » vous ramène directement à la page Code.
- **La génération de documentation n'échoue plus sur les champs optionnels.** Générer la doc d'un design dont un modèle ou un paramètre laissait « required » non renseigné ne s'interrompt plus sur une erreur de template.
- **La suppression d'un enum demande confirmation.** Les enums bénéficient de la même confirmation que les modèles et les routes.
- **La barre latérale révèle votre sélection.** Avec « synchroniser la barre latérale avec l'onglet actif » activé, sélectionner ou créer un modèle, un enum ou une route déplie ses parents pour le garder visible dans l'arborescence.
- **Le bouton d'environnement reste lisible sur toutes les couleurs.** Son libellé passe désormais en texte clair ou foncé pour rester lisible sur la couleur de l'environnement, comme le bouton d'exécution.
- **Le clic du milieu ferme un fichier ouvert.** Un clic du milieu sur une entrée de la liste « Ouverts » de la barre latérale ferme son onglet — et un nouveau réglage Comportement permet de masquer ce panneau.
- **Un libellé plus clair au départ de la documentation.** Dans la documentation d'une API importée, le bouton affiche désormais « Créer une nouvelle requête à partir de cette documentation ».
- **La connexion fonctionne sur la version Microsoft Store.** Le retour de connexion renvoyé par le navigateur (protocole personnalisé) est désormais déclaré dans le paquet Store, donc la connexion aboutit au lieu d'expirer.

## v1.1.0

🎉 **Restorm est maintenant aussi un designer d'API.** Concevez votre API, servez-la comme un mock live sur cinq protocoles à la fois, et générez ses clients — sans quitter l'app, tout sur votre disque.

- **Un designer d'API visuel.** Modélisez votre API à la main — modèles, enums (nommés ou inline), routes, paramètres, exemples nommés, contraintes, tags et dépréciations — sans écrire une ligne de spec.
- **Servez-la en mock, en un clic, sur 5 protocoles à la fois.** Le design devient un serveur qui répond en HTTP, GraphQL, SOAP, OData et gRPC simultanément. Les réponses viennent de vos exemples nommés (ou de données réalistes générées depuis vos modèles), avec validation par contraintes, latence simulée et mode stateful.
- **Des clients prêts à l'emploi, générés automatiquement.** Pendant que le mock tourne, la section Clients crée de vraies requêtes exécutables pour chaque protocole activé, pointées sur les endpoints du mock. Un clic les ouvre et tape le serveur — plus besoin de réimporter votre API ailleurs pour la tester.
- **Générez du code** depuis votre design avec les templates proposés et vos propres templates personnalisés, rendu dans un bac à sable et écrit sur disque seulement après confirmation. **Exportez aussi le descripteur** (OpenAPI et autres).
- **À l'import, les corps de requête se pré-remplissent** : GraphQL sélectionne les champs scalaires du type de retour, gRPC déplie les messages imbriqués — la requête part exécutable direct.

## v1.0.6

Correctifs :

- **Un très gros projet échoue désormais à l'enregistrement avec un message clair, au lieu de se figer.** Si un projet devient trop volumineux pour être écrit sur le disque d'un seul tenant — ce qui peut arriver après l'import d'un schéma d'API inhabituellement gros — Restorm vous prévient clairement qu'il est trop volumineux pour être enregistré, plutôt que de planter ou d'échouer en silence.
- **Un rapport d'erreurs plus clair en coulisses.** L'annulation d'une boîte « Enregistrer sous » n'est plus consignée comme une erreur, et un import échoué remonte désormais sa cause réelle — les vrais problèmes sont ainsi plus faciles à repérer et à corriger.

## v1.0.5

**Le Cookie jar — un bocal de cookies par environnement.**

- **Chaque environnement conserve ses propres cookies.** Connectez-vous à votre API de dev et à votre API de prod depuis deux environnements : leurs sessions ne se croisent jamais — un cookie capturé dans l'un n'est renvoyé que dans celui-là. L'expiration, `Path`, `Domain` et les sous-domaines, `Secure`, `HttpOnly` et `SameSite` sont désormais respectés, plus jetés.
- **Découvrez le Cookie jar.** Un nouvel onglet de l'espace de travail — **Affichage ▸ Cookie jar** — liste les cookies de chaque environnement, groupés par domaine dans des panneaux repliables : modifiez une valeur, supprimez-en un, videz un domaine ou tout le bocal, ou ajoutez un cookie à la main. Il se rafraîchit en direct à mesure que vos requêtes posent des cookies.
- **Voyez ce que chaque requête a envoyé et reçu.** Chaque requête dispose maintenant d'un onglet **Cookies** à côté de Réponse et Infos, qui montre les cookies envoyés avec l'appel et les cookies reçus en retour — y compris les cookies posés lors d'une redirection, qui n'atteignent jamais la réponse finale. Il est aussi présent sur les réponses passées de votre historique.
- **Les connexions par cookie fonctionnent, tout simplement.** Une requête qui renvoie `Set-Cookie` est capturée puis rejouée automatiquement sur les appels protégés qui suivent — y compris au fil d'un scénario, où chaque étape partage le bocal de l'environnement.
- **Les cookies persistent comme dans un navigateur.** Les cookies dotés d'une expiration sont enregistrés par projet et rechargés à la réouverture ; les cookies de session sont abandonnés au redémarrage — exactement comme le ferait un navigateur.
- **Au-delà de REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC et SSE envoient et stockent désormais les cookies, et WebSocket les porte lors de la poignée de main de connexion.
- **Les cookies peuvent utiliser vos variables.** Saisissez `{{token}}` dans un cookie ajouté à la main : il est résolu selon l'environnement actif au moment de l'envoi de la requête.

Correctifs :

- **L'enregistrement automatique couvre désormais les environnements des dossiers.** L'ajout ou le renommage d'un sous-environnement est enregistré immédiatement en mode autosave — fini l'invite « enregistrer avant de fermer ? » pour une modification qui devait déjà être sur le disque.

## v1.0.4

**Une connexion, toutes vos fenêtres.**

- **Votre compte vous suit désormais d'une fenêtre à l'autre.** Connectez-vous, déconnectez-vous ou changez de plan dans une fenêtre Restorm : toutes les autres fenêtres ouvertes l'adoptent instantanément — sans redémarrage, sans seconde connexion. Et quand vous terminez une connexion dans le navigateur, la confirmation arrive maintenant dans la fenêtre qui l'avait demandée, même avec plusieurs fenêtres ouvertes.

Correctifs :

- **Les nœuds de code démarrent à nouveau sur les Mac Intel** — la build macOS Intel embarquait un binaire esbuild compilé pour Apple Silicon.
- **L'action « Nouvelle fenêtre » du lanceur AppImage ouvre à nouveau une fenêtre**, et la commande `restorm` installée par les paquets .deb/.rpm fonctionne à nouveau.
- **Le démarrage sous Windows est assaini** — la fenêtre se charge désormais via le protocole applicatif, sans repli silencieux après une erreur interne à chaque lancement.

## v1.0.3

**Restorm tourne en CI, sans FUSE.**

- **`restorm-cli` fonctionne maintenant sur les runners de CI et dans les conteneurs.** La build Linux est dépaquetée au lieu d'être montée : plus besoin de FUSE, qu'Ubuntu ne fournit plus.

## v1.0.2

**Vos jetons CLI/CI, sans quitter l'application.**

- **Créez, consultez et révoquez vos jetons depuis Restorm** — pour les utilisateurs Pro et Enterprise, depuis le bouton de compte dans la barre de titre. Fini l'aller-retour vers le tableau de bord pour obtenir un jeton destiné au pipeline que vous êtes en train d'écrire.
- **Les jetons peuvent expirer.** Choisissez une durée de vie à la création — 7 à 365 jours, ou sans expiration comme auparavant. Un jeton expiré est refusé exactement comme un jeton révoqué.
- **Votre organisation peut déléguer.** Un administrateur peut désormais autoriser un membre précis à créer des jetons, et séparément lui donner accès au journal d'audit, sans en faire un administrateur.
- **Restorm s'installe désormais depuis npm.** `npm i -g restorm-cli`, puis `restorm` : l'application démarre sous Linux, macOS et Windows sans passer par un installeur. La build est téléchargée une seule fois, vérifiée par son empreinte publiée et conservée en cache — un pipeline ne la retélécharge plus à chaque job.

## v1.0.1

**Premier correctif — déplacements dans la barre latérale, noms d'onglets et rapports d'erreur.**

- **Déplacer un élément dans la barre latérale ne casse plus l'application.** Avec le mini-navigateur, les Paramètres ou les journaux MCP ouverts, faire glisser une ligne de la barre latérale démolissait l'interface, et seul un redémarrage la rétablissait.
- **Renommer un élément met désormais à jour tous les onglets ouverts** — y compris ceux d'un panneau divisé et ceux de tous les types de requêtes (gRPC, GraphQL, Redis…), qui conservaient leur ancien nom jusqu'à réouverture.
- **Les rapports d'erreur nous parviennent à nouveau.** Avec l'envoi de rapports activé, la 1.0.0 n'envoyait rien en silence : un plantage que vous rencontriez ne nous apprenait rien.
- **L'illustration « langages de code » réaffiche ses logos.**

## v1.0.0

**Restorm 1.0 — le client d'API local-first, lancé.**

Restorm est un client de bureau rapide et hors ligne pour tester et piloter des API sur tous les grands protocoles.

- **Protocoles** : REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Scénarios** : enchaînez des requêtes visuellement, branchez/bouclez, extrayez et réutilisez des valeurs, exécutez sans interface dans la CI.
- **Environnements et variables** : `{{handlebars}}` partout, secrets typés, environnements par dossier.
- **Import/Export** : OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, export de code.
- **Projets nativement Git** : votre projet `.restorm` est un simple fichier — versionnez-le, comparez-le, résolvez les conflits dans l'application.
- **Local-first et privé** : tout s'exécute sur votre machine ; un pare-feu sortant contrôle chaque appel externe.
- **Multiplateforme** : Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Édition Community gratuite, avec Pro et Enterprise pour les équipes.
