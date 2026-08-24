# Changelog

## v1.1.0

**Concevez votre API, servez-la comme un mock, et générez ses clients — sans quitter Restorm.**

- **Un designer d'API visuel.** Modélisez votre API à la main — modèles, enums, routes, exemples nommés, contraintes — sans écrire une ligne de spec.
- **Servez-la en mock, en un clic, sur 5 protocoles à la fois.** Le design devient un serveur qui répond en HTTP, GraphQL, SOAP, OData et gRPC simultanément. Les réponses viennent de vos exemples nommés (ou de données réalistes générées depuis vos modèles), avec validation par contraintes, latence simulée et mode stateful.
- **Des clients prêts à l'emploi, générés automatiquement.** Pendant que le mock tourne, la section Clients crée de vraies requêtes exécutables pour chaque protocole activé, pointées sur les endpoints du mock. Un clic les ouvre et tape le serveur — plus besoin de réimporter votre API ailleurs pour la tester.
- **Exportez le descripteur** (OpenAPI et autres) et **générez du code** depuis votre design, rendu dans un bac à sable et écrit sur disque seulement après confirmation.
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
