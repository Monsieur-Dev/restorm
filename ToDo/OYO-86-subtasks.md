# Sous-tâches pour OYO-86 : Refactor Events and File Saving

## 1. Intégration de GraphQL

### Objectif
Embarquer un moteur GraphQL dans l'application pour gérer les données et les événements.

### Sous-tâches
- [ ] Choisir la bibliothèque GraphQL (`graphql`, `@graphql-yoga/node`, etc.)
- [ ] Créer le serveur GraphQL dans le main process (Electron)
- [ ] Créer le moteur GraphQL client dans le renderer (mode web)
- [ ] Définir le schéma GraphQL pour les objets Restorm (Folder, Request, Environment, etc.)
- [ ] Implémenter les résolveurs de base (Query, Mutation)
- [ ] Implémenter les subscriptions GraphQL pour les événements
- [ ] Créer une abstraction pour Electron/Web (`EventService`)

### Livrables
- Serveur GraphQL fonctionnel en mode Electron
- Moteur GraphQL client fonctionnel en mode Web
- Schéma GraphQL de base

### Parent
OYO-86

---

## 2. Système d'événements réactif

### Objectif
Synchroniser automatiquement l'UI via événements IPC/GraphQL.

### Sous-tâches
- [ ] Créer un système d'événements centralisé dans le main process
- [ ] Implémenter les événements IPC pour les changements d'objets (`request:updated`, `folder:created`, etc.)
- [ ] Créer un listener unique au niveau App/Workbench (éviter la multiplication de listeners)
- [ ] Implémenter la détection de source pour éviter les boucles de feedback
- [ ] Ajouter un flag `isEditing`/`isFocused` pour ignorer les événements pendant l'édition
- [ ] Créer un store centralisé (Zustand/Context) pour gérer l'état
- [ ] Connecter la ListView aux événements pour mise à jour automatique
- [ ] Tester avec plusieurs onglets ouverts (performance)

### Livrables
- Système d'événements fonctionnel
- ListView mise à jour automatiquement
- Pas de problèmes de performance avec plusieurs onglets

### Parent
OYO-86

---

## 3. Décorateurs TypeScript pour les objets Restorm

### Objectif
Définir les métadonnées des objets via décorateurs TypeScript.

### Sous-tâches
- [ ] Créer le décorateur `@trackable` (détection des changements via Proxy)
- [ ] Créer le décorateur `@searchable` (indexation pour recherche)
- [ ] Créer le décorateur `@NonSerialised` (exclusion de sérialisation)
- [ ] Créer le décorateur `@separateFiles` (sauvegarde en fichiers séparés)
- [ ] Créer le décorateur `@separateFolders` (création de dossiers physiques pour refléter la hiérarchie)
- [ ] Créer le décorateur `@fileNaming` (pattern de nom de fichier)
- [ ] Implémenter le système de métadonnées (`reflect-metadata`)
- [ ] Refactoriser les classes Restorm existantes pour utiliser les décorateurs :
  - [ ] Refactoriser `RestormObject` (classe abstraite de base)
  - [ ] Refactoriser `Folder` et `EnvironmentFolder`
  - [ ] Refactoriser `Request` et ses sous-classes (`HttpRequest`, `GraphQLRequest`, etc.)
  - [ ] Refactoriser `Environment` et ses sous-environnements
  - [ ] Refactoriser `KeyValue` et autres objets de données
  - [ ] Appliquer `@trackable` sur toutes les classes
  - [ ] Appliquer `@searchable` sur les propriétés recherchables
  - [ ] Appliquer `@NonSerialised` sur les propriétés runtime (id, etc.)
  - [ ] Appliquer `@separateFiles` et `@separateFolders` selon la structure
  - [ ] Appliquer `@fileNaming` sur les classes qui génèrent des fichiers
- [ ] Générer automatiquement le schéma GraphQL depuis les métadonnées

### Livrables
- Décorateurs fonctionnels dans `electron-core-ui`
- Classes Restorm refactorisées et annotées avec les décorateurs
- Code existant migré vers le système de décorateurs
- Schéma GraphQL généré automatiquement

### Parent
OYO-86

---

## 4. Service de contexte basé sur GraphQL

### Objectif
Utiliser GraphQL pour les transformations Handlebars et résolutions de contexte.

### Sous-tâches
- [ ] Refactoriser `ContextService` pour utiliser GraphQL
- [ ] Créer des queries GraphQL pour récupérer le contexte (environnements, variables)
- [ ] Implémenter la résolution de contexte via GraphQL
- [ ] Appliquer les transformations Handlebars avec le contexte dynamique
- [ ] Gérer la sélection d'environnement dans l'éditeur de requête
- [ ] Mettre à jour les URLs résolues et variables calculées via GraphQL
- [ ] Émettre des événements lors des changements de contexte

### Livrables
- Service de contexte refactorisé utilisant GraphQL
- Transformations Handlebars fonctionnelles avec contexte dynamique

### Parent
OYO-86

---

## 5. Recherche via GraphQL

### Objectif
Intégrer la recherche dans GraphQL en utilisant les champs `@searchable`.

### Sous-tâches
- [ ] Créer des queries GraphQL pour la recherche (`searchRequests`, `searchFolders`, etc.)
- [ ] Implémenter les résolveurs de recherche utilisant les champs `@searchable`
- [ ] Mettre à jour l'index de recherche via événements GraphQL
- [ ] Implémenter la recherche dans le renderer
- [ ] Optimiser les performances de recherche (indexation, filtrage)
- [ ] Tester la recherche en mode Electron et Web

### Livrables
- Recherche fonctionnelle via GraphQL
- Index de recherche mis à jour automatiquement
- Performances satisfaisantes pour les collections Restorm

### Parent
OYO-86

---

## 6. Persistance et sérialisation

### Objectif
Refactoriser la sauvegarde pour utiliser GraphQL et gérer les deux modes (fichier unique / dossier).

### Sous-tâches
- [ ] Refactoriser `PersistenceService` pour utiliser GraphQL (optionnel)
- [ ] Implémenter la sérialisation directe depuis objets en mémoire (utiliser `@NonSerialised`)
- [ ] Implémenter le support des formats de sérialisation :
  - [ ] JSON (déjà supporté)
  - [ ] YAML (déjà supporté)
  - [ ] JSON5 (nouveau : support des commentaires, trailing commas, etc.)
- [ ] Créer le mode "fichier unique" (comme actuellement)
- [ ] Créer le mode "dossier" avec structure de fichiers et dossiers
- [ ] Implémenter la logique `@separateFolders` (création de dossiers physiques) :
  - [ ] EnvironmentFolder → dossier physique
  - [ ] Folder → dossier physique
  - [ ] Sous-dossiers (Folder dans Folder) → sous-dossiers physiques
  - [ ] Sous-environnements (Environment dans Environment) → sous-dossiers physiques
- [ ] Implémenter la logique `@separateFiles` (création de fichiers séparés) :
  - [ ] Environment dans EnvironmentFolder → fichier dans le dossier
  - [ ] Request dans Folder → fichier dans le dossier
  - [ ] Respecter la hiérarchie des dossiers créés par `@separateFolders`
- [ ] Implémenter la logique `@fileNaming` (génération de noms de fichiers)
- [ ] Gérer les collisions de noms (préfixes numériques, `(1)`, `(2)`, etc.)
- [ ] Implémenter le chargement depuis le mode dossier
- [ ] Gérer la synchronisation objets ↔ fichiers (renommage, suppression, déplacement)
- [ ] Créer une modale de sélection pour File -> New et Save As :
  - [ ] Choix du mode (fichier unique / dossier)
  - [ ] Choix du format de sérialisation (JSON / YAML / JSON5)
  - [ ] Validation avec bouton OK
- [ ] Adapter les dialogues de sauvegarde selon le mode :
  - [ ] Mode fichier : dialogue de sélection de fichier (comme actuellement)
  - [ ] Mode dossier : dialogue de sélection de dossier (nouveau)
- [ ] Modifier le menu File :
  - [ ] File -> Open : ouvre un fichier (mode fichier unique)
  - [ ] File -> Open folder : ouvre un dossier (mode dossier) - nouveau
  - [ ] File -> New : affiche la modale de sélection (mode + format)
  - [ ] File -> Save As : affiche la modale de sélection (mode + format)
- [ ] Implémenter le chargement depuis un dossier (File -> Open folder)
- [ ] Implémenter la gestion fine du dirty state :
  - [ ] Mode fichier unique : dirty state au niveau du titre de la fenêtre et de la barre des tâches
  - [ ] Mode dossier : dirty state au niveau de chaque onglet (chaque onglet = un fichier)
  - [ ] Suivre l'état dirty par fichier/onglet individuellement
  - [ ] Mettre à jour l'indicateur visuel (icône, badge, etc.) sur les onglets

### Livrables
- Service de persistance refactorisé
- Support des formats JSON, YAML et JSON5
- Modale de sélection (mode + format) pour File -> New et Save As
- Dialogues de sauvegarde adaptés (fichier ou dossier selon le mode)
- Menu File mis à jour (Open, Open folder, New, Save As)
- Mode "fichier unique" fonctionnel
- Mode "dossier" fonctionnel avec arborescence de dossiers et fichiers séparés
- Arborescence de dossiers reflétant la hiérarchie logique (EnvironmentFolder, Folder, sous-environnements)
- Gestion des collisions de noms
- Gestion fine du dirty state selon le mode

### Parent
OYO-86

---

## 7. Architecture des objets en mémoire

### Objectif
Définir où stocker les objets selon le mode (Electron/Web).

### Sous-tâches
- [ ] Créer un store centralisé pour les objets Restorm
- [ ] En Electron : stocker les objets dans le main process
- [ ] En Web : stocker les objets dans le renderer
- [ ] Créer une abstraction pour accéder au store (Electron/Web)
- [ ] Connecter GraphQL au store
- [ ] Implémenter la synchronisation store ↔ GraphQL

### Livrables
- Store centralisé fonctionnel
- Objets accessibles via GraphQL
- Architecture cohérente Electron/Web

### Parent
OYO-86

---

## 8. Tests et validation

### Objectif
Valider le fonctionnement dans tous les scénarios.

### Sous-tâches

#### Tests fonctionnels
- [ ] Tester les événements avec plusieurs onglets ouverts
- [ ] Tester les boucles de feedback (modification → événement → UI)
- [ ] Tester la recherche en mode Electron et Web
- [ ] Tester la modale de sélection (mode + format) pour File -> New
- [ ] Tester la modale de sélection (mode + format) pour File -> Save As
- [ ] Tester la sauvegarde en mode fichier unique (dialogue de fichier)
- [ ] Tester la sauvegarde en mode dossier (dialogue de dossier)
- [ ] Tester File -> Open (fichier unique)
- [ ] Tester File -> Open folder (dossier)
- [ ] Tester le chargement depuis les deux modes
- [ ] Tester la sérialisation/désérialisation pour chaque format (JSON, YAML, JSON5)
- [ ] Tester les transformations Handlebars avec différents environnements
- [ ] Tester les performances avec de grandes collections
- [ ] Tester la gestion du dirty state en mode fichier unique
- [ ] Tester la gestion du dirty state en mode dossier (par onglet)

#### Tests unitaires
- [ ] Tests unitaires pour les décorateurs (`@trackable`, `@searchable`, `@NonSerialised`, etc.)
- [ ] Tests unitaires pour le service GraphQL (résolveurs, mutations, queries)
- [ ] Tests unitaires pour le système d'événements
- [ ] Tests unitaires pour le service de contexte
- [ ] Tests unitaires pour le service de persistance (sérialisation, modes fichier/dossier)
- [ ] Tests unitaires pour chaque format de sérialisation (JSON, YAML, JSON5)
- [ ] Tests unitaires pour la génération de noms de fichiers
- [ ] Tests unitaires pour la gestion des collisions de noms
- [ ] Tests unitaires pour le store centralisé

#### Tests d'interface graphique
- [ ] Tests E2E pour la création/modification de requêtes
- [ ] Tests E2E pour la synchronisation de la ListView via événements
- [ ] Tests E2E pour la recherche via GraphQL
- [ ] Tests E2E pour la modale de sélection (mode + format)
- [ ] Tests E2E pour les dialogues de sauvegarde (fichier vs dossier)
- [ ] Tests E2E pour File -> Open et File -> Open folder
- [ ] Tests E2E pour le mode fichier unique (sauvegarde, chargement, dirty state)
- [ ] Tests E2E pour le mode dossier (sauvegarde, chargement, dirty state par onglet)
- [ ] Tests E2E pour chaque format de sérialisation (JSON, YAML, JSON5)
- [ ] Tests E2E pour les transformations Handlebars dans l'UI
- [ ] Tests E2E pour la gestion des onglets multiples
- [ ] Tests visuels pour les indicateurs de dirty state

### Livrables
- Suite de tests complète (fonctionnels, unitaires, E2E)
- Validation de tous les scénarios
- Couverture de code satisfaisante

### Parent
OYO-86

---

## 9. Validation de la séparation des responsabilités

### Objectif
S'assurer qu'aucun concept spécifique à Restorm n'a été introduit dans `electron-core-ui`, qui doit rester générique et réutilisable.

### Sous-tâches
- [ ] Auditer tous les fichiers ajoutés/modifiés dans `electron-core-ui` :
  - [ ] Vérifier qu'aucune référence à Restorm n'existe (imports, types, noms de classes, etc.)
  - [ ] Vérifier qu'aucun concept métier Restorm n'est présent (Request, Folder, Environment, etc.)
  - [ ] Vérifier que les décorateurs sont génériques et réutilisables
  - [ ] Vérifier que les services sont génériques (GraphQL, événements, persistance)
- [ ] Vérifier que tous les concepts spécifiques à Restorm sont bien dans le projet `restorm` :
  - [ ] Les classes Restorm (RestormObject, Folder, Request, etc.)
  - [ ] Les résolveurs GraphQL spécifiques à Restorm
  - [ ] Les schémas GraphQL spécifiques à Restorm
  - [ ] La logique métier Restorm
- [ ] Vérifier l'interface entre `electron-core-ui` et `restorm` :
  - [ ] Les décorateurs de `electron-core-ui` sont utilisés par les classes Restorm
  - [ ] Les services génériques de `electron-core-ui` sont utilisés par Restorm
  - [ ] Aucune dépendance circulaire
- [ ] Documenter l'architecture de séparation :
  - [ ] Documenter ce qui appartient à `electron-core-ui` (générique)
  - [ ] Documenter ce qui appartient à `restorm` (spécifique)
  - [ ] Documenter les points d'intégration

### Livrables
- Audit complet de `electron-core-ui` sans concepts Restorm
- Documentation de l'architecture de séparation
- Validation que `electron-core-ui` reste générique et réutilisable

### Parent
OYO-86

---

## Priorisation suggérée

1. **Phase 1 (Fondations)** : Tâches 1, 3, 7
2. **Phase 2 (Événements)** : Tâche 2
3. **Phase 3 (Contexte)** : Tâche 4
4. **Phase 4 (Recherche)** : Tâche 5
5. **Phase 5 (Persistance)** : Tâche 6
6. **Phase 6 (Validation)** : Tâche 8
7. **Phase 7 (Audit final)** : Tâche 9

