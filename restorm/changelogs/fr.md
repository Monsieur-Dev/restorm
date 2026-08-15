# Changelog

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
