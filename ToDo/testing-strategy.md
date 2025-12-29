# Stratégie de tests approfondis pour Restorm

## Objectif
Implémenter une suite de tests complète pour éviter les régressions sur l'interface graphique et les fonctionnalités lors de la refactorisation majeure (OYO-86).

## Technologies proposées

### 1. **Playwright** (déjà présent) - Tests E2E Electron
**Pourquoi :**
- Support natif d'Electron via `playwright-electron`
- Tests cross-platform (Windows, Linux, macOS)
- Capture d'écran automatique
- Traces et vidéos des tests
- Interception réseau et console

**Utilisation :**
- Tests de bout en bout de l'application Electron
- Tests de chargement de fichiers
- Tests d'interactions utilisateur complètes
- Tests de navigation et workflows

### 2. **Playwright Visual Comparisons** - Tests de régression visuelle
**Pourquoi :**
- Détection automatique des changements visuels
- Comparaison pixel par pixel
- Gestion des différences acceptables (flakiness)
- Intégration avec Playwright

**Utilisation :**
- Screenshots de chaque composant critique
- Comparaison avant/après refactorisation
- Validation de l'UI sur différents thèmes
- Validation responsive (si applicable)

### 3. **Playwright Code Coverage** - Couverture de code
**Pourquoi :**
- Mesure de la couverture de code depuis les tests E2E
- Identification des zones non testées
- Intégration avec Playwright

**Utilisation :**
- Mesurer la couverture fonctionnelle
- Identifier les chemins de code non testés
- Objectif : >80% de couverture sur les fonctionnalités critiques

### 4. **Console Error Monitoring** - Détection d'erreurs console
**Pourquoi :**
- Intercepter toutes les erreurs console (renderer + main process)
- Détecter les warnings React
- Détecter les erreurs JavaScript non catchées
- Détecter les erreurs dans DevTools

**Implémentation :**
```typescript
// Intercepter les erreurs console dans Playwright
page.on('console', msg => {
  if (msg.type() === 'error') {
    // Échouer le test si erreur console
  }
});

// Intercepter les erreurs non catchées
page.on('pageerror', error => {
  // Échouer le test
});
```

### 5. **Accessibility Testing (a11y)** - Tests d'accessibilité
**Pourquoi :**
- Détecter les problèmes d'accessibilité
- Validation WCAG
- Tests automatiques de navigation clavier
- Tests de lecteurs d'écran

**Technologies :**
- `@axe-core/playwright` : Tests d'accessibilité automatiques
- `playwright-axe` : Intégration Axe avec Playwright

**Utilisation :**
- Tests automatiques sur chaque page/composant
- Validation des attributs ARIA
- Validation de la navigation clavier
- Validation du contraste des couleurs

### 6. **Performance Testing** - Tests de performance
**Pourquoi :**
- Détecter les régressions de performance
- Mesurer le temps de chargement
- Mesurer le temps de réponse des interactions
- Identifier les fuites mémoire

**Métriques à surveiller :**
- Temps de chargement initial
- Temps de chargement d'un fichier
- Temps de sauvegarde
- Temps de recherche
- Mémoire utilisée
- FPS (si animations)

### 7. **File Loading Tests** - Tests de chargement de fichiers
**Pourquoi :**
- Valider le chargement de différents formats (JSON, YAML, JSON5)
- Valider le chargement de gros fichiers
- Valider le chargement de fichiers corrompus
- Valider le chargement de fichiers avec structure complexe

**Scénarios :**
- Charger un fichier `.restorm` simple
- Charger un fichier `.restorm` complexe (multi-niveaux)
- Charger un fichier corrompu (doit afficher erreur)
- Charger un fichier avec beaucoup de requêtes (>100)
- Charger un fichier avec beaucoup d'environnements

### 8. **Component Testing** - Tests de composants isolés
**Pourquoi :**
- Tester les composants React individuellement
- Tests plus rapides que E2E
- Tests de props et états
- Tests d'interactions utilisateur

**Technologies :**
- `@testing-library/react` (déjà présent)
- `@testing-library/user-event` : Simuler les interactions utilisateur
- `@testing-library/jest-dom` (déjà présent) : Matchers DOM

**Utilisation :**
- Tests unitaires de chaque composant critique
- Tests de props et états
- Tests d'événements utilisateur
- Tests de rendu conditionnel

## Structure de tests proposée

### Tests E2E Electron (Playwright)
```
tests/e2e/
├── application/
│   ├── app-launch.spec.ts          # Lancement de l'app
│   ├── file-operations.spec.ts     # Ouvrir, sauvegarder, nouveau fichier
│   ├── file-loading.spec.ts        # Chargement de fichiers (JSON, YAML, JSON5)
│   └── error-handling.spec.ts      # Gestion des erreurs
├── components/
│   ├── listview.spec.ts            # Tests de la ListView
│   ├── request-editor.spec.ts      # Tests de l'éditeur de requête
│   ├── environment-editor.spec.ts  # Tests de l'éditeur d'environnement
│   └── search.spec.ts              # Tests de la recherche
├── workflows/
│   ├── create-request.spec.ts     # Workflow complet : créer une requête
│   ├── execute-request.spec.ts    # Workflow complet : exécuter une requête
│   ├── manage-environments.spec.ts # Workflow complet : gérer les environnements
│   └── file-mode-switch.spec.ts   # Basculer entre mode fichier/dossier
├── visual/
│   ├── theme-regression.spec.ts    # Tests de régression visuelle des thèmes
│   ├── component-screenshots.spec.ts # Screenshots de tous les composants
│   └── layout-validation.spec.ts  # Validation de la mise en page
└── integration/
    ├── graphql-integration.spec.ts # Tests d'intégration GraphQL
    ├── events-integration.spec.ts  # Tests d'intégration événements
    └── persistence-integration.spec.ts # Tests d'intégration persistance
```

### Tests unitaires de composants
```
tests/unit/components/
├── ListView.test.tsx
├── RequestTabView.test.tsx
├── EnvironmentFolderView.test.tsx
├── SearchBar.test.tsx
└── ...
```

### Tests d'accessibilité
```
tests/a11y/
├── navigation.spec.ts              # Navigation clavier
├── screen-reader.spec.ts           # Tests lecteur d'écran
└── wcag-validation.spec.ts         # Validation WCAG
```

## Scénarios de tests critiques

### 1. Chargement de fichiers
- [ ] Charger un fichier JSON simple
- [ ] Charger un fichier YAML simple
- [ ] Charger un fichier JSON5 simple
- [ ] Charger un fichier avec structure complexe (multi-niveaux)
- [ ] Charger un fichier corrompu (doit afficher erreur claire)
- [ ] Charger un fichier avec >100 requêtes (performance)
- [ ] Charger un fichier avec beaucoup d'environnements
- [ ] Vérifier qu'aucune erreur console n'apparaît
- [ ] Vérifier que tous les composants sont bien rendus

### 2. Sauvegarde de fichiers
- [ ] Sauvegarder en mode fichier unique (JSON)
- [ ] Sauvegarder en mode fichier unique (YAML)
- [ ] Sauvegarder en mode fichier unique (JSON5)
- [ ] Sauvegarder en mode dossier
- [ ] Vérifier que le dirty state se met à jour correctement
- [ ] Vérifier qu'aucune erreur console n'apparaît

### 3. Interface graphique
- [ ] Tous les composants sont visibles et accessibles
- [ ] La ListView affiche correctement les folders/requests
- [ ] Les onglets fonctionnent correctement
- [ ] La barre de recherche fonctionne
- [ ] Les menus fonctionnent
- [ ] Les dialogues modaux s'affichent correctement
- [ ] Aucune erreur console
- [ ] Aucun warning React

### 4. Fonctionnalités principales
- [ ] Créer une requête HTTP
- [ ] Créer une requête GraphQL
- [ ] Exécuter une requête
- [ ] Voir la réponse
- [ ] Créer un environnement
- [ ] Utiliser des variables d'environnement
- [ ] Rechercher dans les requêtes
- [ ] Filtrer par type de requête

### 5. Événements et réactivité
- [ ] Modifier une requête → ListView se met à jour
- [ ] Créer une requête → ListView se met à jour
- [ ] Supprimer une requête → ListView se met à jour
- [ ] Modifier un environnement → Variables se mettent à jour
- [ ] Pas de boucles infinies
- [ ] Pas d'erreurs console lors des mises à jour

### 6. Performance
- [ ] Temps de chargement initial < 3s
- [ ] Temps de chargement d'un fichier < 1s (fichier moyen)
- [ ] Temps de sauvegarde < 500ms
- [ ] Recherche instantanée (< 100ms)
- [ ] Pas de fuites mémoire après plusieurs opérations
- [ ] FPS stable (si animations)

### 7. Accessibilité
- [ ] Navigation clavier complète
- [ ] Focus visible sur tous les éléments interactifs
- [ ] Attributs ARIA corrects
- [ ] Contraste des couleurs suffisant (WCAG AA)
- [ ] Pas d'erreurs Axe

## Configuration Playwright proposée

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { _electron as electron } from 'playwright';

export default defineConfig({
  testDir: './tests/e2e',
  
  // Timeouts
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  
  // Retry
  retries: process.env.CI ? 2 : 0,
  
  // Workers
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  
  // Shared settings
  use: {
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
    // Trace
    trace: 'on-first-retry',
    
    // Console errors should fail tests
    actionTimeout: 10000,
  },
  
  // Projects
  projects: [
    {
      name: 'electron',
      use: {
        // Configuration Electron
      },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  
  // Global setup/teardown
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
});
```

## Helpers et utilitaires de test

### Console Error Interceptor
```typescript
// tests/e2e/helpers/console-error-interceptor.ts
export async function setupConsoleErrorInterceptor(page: Page) {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    } else if (msg.type() === 'warning') {
      warnings.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  
  return {
    errors,
    warnings,
    assertNoErrors: () => {
      expect(errors).toHaveLength(0);
    },
    assertNoWarnings: () => {
      expect(warnings).toHaveLength(0);
    },
  };
}
```

### File Loading Helper
```typescript
// tests/e2e/helpers/file-loader.ts
export async function loadRestormFile(
  page: Page,
  filePath: string,
  format: 'json' | 'yaml' | 'json5'
) {
  // Ouvrir le dialogue de fichier
  // Sélectionner le fichier
  // Vérifier le chargement
  // Vérifier qu'aucune erreur n'apparaît
}
```

### Visual Comparison Helper
```typescript
// tests/e2e/helpers/visual-comparison.ts
export async function compareVisual(
  page: Page,
  componentName: string,
  options?: { threshold?: number }
) {
  await expect(page).toHaveScreenshot(`${componentName}.png`, {
    threshold: options?.threshold || 0.2,
  });
}
```

## Checklist d'implémentation

### Phase 1 : Infrastructure
- [ ] Configurer Playwright pour Electron
- [ ] Configurer les tests visuels (screenshots)
- [ ] Configurer l'interception des erreurs console
- [ ] Créer les helpers de test
- [ ] Configurer les tests d'accessibilité (Axe)

### Phase 2 : Tests de base
- [ ] Tests de lancement de l'application
- [ ] Tests de chargement de fichiers (JSON, YAML, JSON5)
- [ ] Tests de sauvegarde de fichiers
- [ ] Tests de console (aucune erreur)

### Phase 3 : Tests de composants
- [ ] Tests de la ListView
- [ ] Tests de l'éditeur de requête
- [ ] Tests de la barre de recherche
- [ ] Tests des onglets
- [ ] Tests des menus

### Phase 4 : Tests de workflows
- [ ] Workflow complet : créer une requête
- [ ] Workflow complet : exécuter une requête
- [ ] Workflow complet : gérer les environnements
- [ ] Workflow complet : basculer entre modes

### Phase 5 : Tests visuels
- [ ] Screenshots de tous les composants
- [ ] Tests de régression visuelle
- [ ] Tests sur différents thèmes

### Phase 6 : Tests de performance
- [ ] Tests de temps de chargement
- [ ] Tests de temps de sauvegarde
- [ ] Tests de mémoire
- [ ] Tests de recherche

### Phase 7 : Tests d'accessibilité
- [ ] Tests de navigation clavier
- [ ] Tests WCAG
- [ ] Tests de contraste

### Phase 8 : Validation des tests (Chaos Testing)
**Objectif** : Vérifier que les tests détectent bien les problèmes en cassant volontairement le code.

- [ ] Introduire une erreur console volontaire → vérifier que le test échoue
- [ ] Casser un composant UI (masquer un élément) → vérifier que le test visuel échoue
- [ ] Casser la fonctionnalité de chargement de fichier → vérifier que le test échoue
- [ ] Introduire une régression de performance → vérifier que le test de performance échoue
- [ ] Casser l'accessibilité (retirer un attribut ARIA) → vérifier que le test Axe échoue
- [ ] Casser un workflow complet (création de requête) → vérifier que le test de workflow échoue
- [ ] Introduire une fuite mémoire → vérifier que le test de mémoire échoue
- [ ] Casser la synchronisation des événements → vérifier que le test de réactivité échoue
- [ ] Casser la sauvegarde de fichier → vérifier que le test de sauvegarde échoue
- [ ] Casser la recherche → vérifier que le test de recherche échoue
- [ ] Vérifier que tous les tests échouent de manière claire et informative
- [ ] Restaurer le code après validation

**Note** : Cette phase doit être effectuée dans une branche dédiée et ne jamais être mergée en main.

## Métriques de succès

- **Couverture de code** : >80% sur les fonctionnalités critiques
- **Temps d'exécution** : <10 minutes pour toute la suite de tests
- **Stabilité** : <5% de tests flaky
- **Erreurs console** : 0 erreur tolérée
- **Accessibilité** : 0 erreur Axe critique
- **Performance** : Tous les seuils respectés

## Maintenance

- Exécuter les tests avant chaque commit
- Exécuter les tests visuels avant chaque release
- Mettre à jour les screenshots lors de changements UI intentionnels
- Ajouter de nouveaux tests pour chaque nouvelle fonctionnalité
- Réviser les tests régulièrement pour éviter la dette technique

