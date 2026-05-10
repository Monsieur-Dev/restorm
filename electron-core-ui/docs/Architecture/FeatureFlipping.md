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

## FeatureFlippingService API

### Initialization (Main Process)

```typescript
import { initFeatureService, getFeatureService, isFeatureServiceInitialized } from 'electron-core-ui/main'

// Initialize singleton (typically done inside setupIPC or manually)
const service = initFeatureService(
  path.join(__dirname, '../resources/features.yaml'),
  appFeaturesYamlPath,  // optional per-app overrides
  'desktop',            // FeaturePlatform, defaults to 'desktop'
  app.isPackaged ? 'prod' : 'dev'  // FeatureEnvironment, defaults to 'prod'
)
```

### Instance Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `isEnabled(featureName)` | `boolean` | Evaluate all strategies; `false` if feature not found |
| `getPlatform()` | `FeaturePlatform` | Current runtime platform (`'desktop'` or `'web'`) |
| `getEnvironment()` | `FeatureEnvironment` | Current build environment (`'dev'` or `'prod'`) |
| `listFeatures()` | `string[]` | All registered feature names (for debugging) |

### Singleton Access

| Function | Description |
|----------|-------------|
| `initFeatureService(configPath, platform?)` | Legacy signature — creates the singleton without per-app overrides |
| `initFeatureService(defaultPath, appPath, platform?, environment?)` | New signature with overrides + environment |
| `getFeatureService()` | Get the singleton; throws if not initialized |
| `isFeatureServiceInitialized()` | Check if the singleton exists |

## IPC Channels

| Channel | Args | Returns | Description |
|---------|------|---------|-------------|
| `feature:is-enabled` | `featureName: string` | `boolean` | Check if a feature is enabled |
| `feature:get-platform` | -- | `FeaturePlatform` | Get the runtime platform |
| `feature:get-environment` | -- | `FeatureEnvironment` | Get the build environment |

Handlers return safe defaults (`false` / `'desktop'` / `'prod'`) if the service is not initialized.

## React Hooks and Utilities

All exported from `electron-core-ui/renderer`.

### useFeature(name)

Hook to check if a feature is enabled. Queries the main process on mount.

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
