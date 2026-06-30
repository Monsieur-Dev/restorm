# Feature Flipping Architecture

YAML-driven feature flags with strategy-based evaluation.

## Overview

The feature flipping system enables toggling features on or off based on configurable strategies. Features are defined in a YAML config file and evaluated at runtime in the main process. The renderer accesses feature state via IPC through React hooks or imperative utilities.

Key properties:

- **AND logic**: all strategies on a feature must return `true` for the feature to be enabled
- **Strategy-based**: extensible evaluation via typed strategy objects
- **Singleton service**: initialized once in the main process, queried from renderer

## Configuration Format

Features are declared in a YAML file:

```yaml
Features:
  - Name: "dark-mode"
    Strategies:
      - Type: Basic
        Enabled: true

  - Name: "new-editor"
    Strategies:
      - Type: Basic
        Enabled: true
      - Type: Platform
        AvailableOn:
          - desktop

  - Name: "experimental-sync"
    Strategies:
      - Type: Basic
        Enabled: false
```

### Feature Definition

| Field | Required | Description |
|-------|----------|-------------|
| `Name` | Yes | Unique feature identifier |
| `Strategies` | Yes | Array of strategy objects (all must pass) |

## Strategy Types

### Basic

Simple on/off toggle.

```yaml
- Type: Basic
  Enabled: true  # or false
```

| Field | Type | Description |
|-------|------|-------------|
| `Type` | `"Basic"` | Strategy discriminator |
| `Enabled` | `boolean` | Whether the feature is enabled |

### Platform

Enables the feature only on specified platforms.

```yaml
- Type: Platform
  AvailableOn:
    - desktop
    - web
```

| Field | Type | Description |
|-------|------|-------------|
| `Type` | `"Platform"` | Strategy discriminator |
| `AvailableOn` | `FeaturePlatform[]` | Allowed platforms: `"desktop"`, `"web"` |

### Environment

Enables the feature only in specified build environments. `dev` covers any unpackaged run (electron-vite dev, `pnpm dev`, the test harness); `prod` covers packaged binaries shipped to users.

```yaml
- Type: Environment
  AvailableIn:
    - dev
```

| Field | Type | Description |
|-------|------|-------------|
| `Type` | `"Environment"` | Strategy discriminator |
| `AvailableIn` | `FeatureEnvironment[]` | Allowed environments: `"dev"`, `"prod"` |

Use this to ship debug-only surfaces — internal CTAs, test buttons, instrumentation panels — that disappear from packaged builds without code-stripping. The host app passes the current environment to `initFeatureService` (typically `app.isPackaged ? 'prod' : 'dev'`).

## AND Logic

When a feature has multiple strategies, **all** must return `true`:

```yaml
- Name: "desktop-only-beta"
  Strategies:
    - Type: Basic
      Enabled: true       # feature flag is on
    - Type: Platform
      AvailableOn:
        - desktop          # only on desktop
```

This feature is enabled only when `Basic.Enabled` is `true` AND the runtime platform is `desktop`.

A feature with no strategies returns `false`.

## Custom Strategies

ECUI's strategy set is open for extension. A consuming app can register its own strategy types — evaluators that ECUI knows nothing about semantically — and they participate in the same AND-logic as the built-ins.

### Registering an Evaluator

```typescript
import { getFeatureService } from 'electron-core-ui/main'
import type { CustomStrategyConfig } from 'electron-core-ui'

// Call after initFeatureService (e.g. in the same app-ready callback).
getFeatureService().registerStrategy(
  'Entitlement',
  (config: CustomStrategyConfig): boolean => {
    const caps = config['RequiredCapabilities'] as string[]
    // read LIVE state from a closure — the evaluator is called on every isEnabled()
    return caps.every(cap => myEntitlementService.hasCapability(cap))
  }
)
```

The evaluator is called **synchronously on every `isEnabled()` invocation** — it must be fast (no I/O; no async). Live state is read through a closure the evaluator holds.

ECUI remains generic: it orchestrates evaluators, but knows nothing about the semantics of capabilities, plans, or user roles.

### YAML Config for Custom Strategies

Custom strategy types appear in the features YAML like any built-in strategy. Unknown `Type` values that have no registered evaluator are silently treated as disabled (a warning is logged).

```yaml
Features:
  - Name: "scenario.stepDebug"
    Strategies:
      - Type: Entitlement
        RequiredCapabilities:
          - "scenario.stepDebug"

  - Name: "mcp.pro"
    Strategies:
      - Type: Entitlement
        RequiredCapabilities:
          - "mcp.pro"
```

### Reactivity — Invalidation

Custom strategies may depend on state that changes at runtime (e.g. login / logout / entitlement refresh). The service exposes an explicit pub/sub pair:

```typescript
// Subscribe to invalidation notifications
const unsubscribe = getFeatureService().subscribe(() => {
  // re-query isEnabled here, or push a renderer notification
})

// Call when external state has changed
getFeatureService().invalidate()
```

In practice the host app calls `invalidate()` from the same place it broadcasts the auth state change. The IPC handler in ECUI subscribes internally and pushes `feature:changed` to all renderer windows, so `useFeature` hooks re-render automatically.

## FeatureFlippingService API

### Initialization (Main Process)

```typescript
import { initFeatureService, getFeatureService, isFeatureServiceInitialized } from 'electron-core-ui/main'

// Initialized automatically by setupIPC / initializeApp; options form:
const service = initFeatureService({
  defaultConfigPath: path.join(__dirname, '../resources/features.yaml'),
  appConfigPath: appFeaturesYamlPath,      // optional per-app overrides
  platform: 'desktop',                     // FeaturePlatform, default 'desktop'
  environment: app.isPackaged ? 'prod' : 'dev'  // FeatureEnvironment, default 'prod'
})
```

### Instance Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `isEnabled(featureName)` | `boolean` | Evaluate all strategies (AND); `false` if feature not found |
| `registerStrategy(type, evaluator)` | `void` | Register an evaluator for a custom strategy type |
| `subscribe(listener)` | `() => void` | Subscribe to invalidation notifications; returns unsubscribe |
| `invalidate()` | `void` | Signal external state change; fires all subscribers |
| `getPlatform()` | `FeaturePlatform` | Current runtime platform (`'desktop'` or `'web'`) |
| `getEnvironment()` | `FeatureEnvironment` | Current build environment (`'dev'` or `'prod'`) |
| `listFeatures()` | `string[]` | All registered feature names (for debugging) |

### Singleton Access

| Function | Description |
|----------|-------------|
| `initFeatureService(options)` | Create the singleton; idempotent (returns existing if already init) |
| `getFeatureService()` | Get the singleton; throws if not initialized |
| `isFeatureServiceInitialized()` | Check if the singleton exists |

## IPC Channels

| Channel | Direction | Args | Returns | Description |
|---------|-----------|------|---------|-------------|
| `feature:is-enabled` | main→renderer (invoke) | `featureName: string` | `boolean` | Check if a feature is enabled |
| `feature:get-platform` | main→renderer (invoke) | -- | `FeaturePlatform` | Get the runtime platform |
| `feature:get-environment` | main→renderer (invoke) | -- | `FeatureEnvironment` | Get the build environment |
| `feature:changed` | main→renderer (send) | -- | -- | Feature state may have changed; re-query `isEnabled` |

Invoke handlers return safe defaults (`false` / `'desktop'` / `'prod'`) if the service is not initialized. `feature:changed` is pushed when `invalidate()` is called.

## React Hooks and Utilities

All exported from `electron-core-ui/renderer`.

### useFeature(name)

Hook to check if a feature is enabled. Reactive: re-evaluates on mount **and** whenever the main process pushes `feature:changed` (e.g. after an entitlement refresh). No restart required.

```tsx
const { isEnabled, isLoading } = useFeature('new-editor')

if (isLoading) return <Spinner />
if (!isEnabled) return null

return <NewEditor />
```

### usePlatformFeature()

Hook to get the current runtime platform.

```tsx
const { platform, isLoading } = usePlatformFeature()
// platform: 'desktop' | 'web'
```

### useIsDesktop()

Convenience hook wrapping `usePlatformFeature()`.

```tsx
const { isDesktop, isLoading } = useIsDesktop()
```

### checkFeature(name)

Imperative (non-hook) function for use outside React components.

```typescript
const enabled = await checkFeature('dark-mode')
```

### getPlatform()

Imperative function to get the current platform.

```typescript
const platform = await getPlatform()
```

## Usage in Consumer Apps

### 1. Create a features YAML config

```yaml
# resources/features.yaml
Features:
  - Name: "sidebar-v2"
    Strategies:
      - Type: Basic
        Enabled: true
      - Type: Platform
        AvailableOn:
          - desktop

  - Name: "cloud-sync"
    Strategies:
      - Type: Basic
        Enabled: false
```

### 2. Initialize in the main process

The feature service is typically initialized as part of `setupIPC` or manually before creating windows:

```typescript
import { initFeatureService } from 'electron-core-ui/main'

initFeatureService(
  path.join(__dirname, '../resources/features.yaml'),
  'desktop'
)
```

### 3. Use hooks in the renderer

```tsx
import { useFeature } from 'electron-core-ui/renderer'

const SidebarContainer: React.FC = () => {
  const { isEnabled, isLoading } = useFeature('sidebar-v2')

  if (isLoading) return null

  return isEnabled ? <SidebarV2 /> : <SidebarV1 />
}
```

## Types

```typescript
type FeaturePlatform = 'desktop' | 'web'
type FeatureEnvironment = 'dev' | 'prod'

interface BasicStrategy {
  Type: 'Basic'
  Enabled: boolean
}

interface PlatformStrategy {
  Type: 'Platform'
  AvailableOn: FeaturePlatform[]
}

interface EnvironmentStrategy {
  Type: 'Environment'
  AvailableIn: FeatureEnvironment[]
}

type FeatureStrategy = BasicStrategy | PlatformStrategy | EnvironmentStrategy

interface FeatureConfig {
  Name: string
  Strategies: FeatureStrategy[]
}

interface FeaturesYamlConfig {
  Features: FeatureConfig[]
}
```
