# Changelog

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
