# Feature Flipping Service

## Overview

The Feature Flipping Service provides a flexible way to enable or disable features in your application based on configurable strategies. It supports multiple strategies that can be combined, and is configured via a YAML file.

**Key Feature:** Multiple strategies can be applied to a single feature - ALL strategies must return `true` for the feature to be enabled (AND logic).

## Architecture

### Main Process (electron-core-ui)

The service is implemented as a singleton in `electron-core-ui/src/main/services/FeatureFlippingService.ts`.

**Key Components:**

- `FeatureFlippingService` - Main service class
- `initFeatureService(configPath, platform)` - Initialize the singleton
- `getFeatureService()` - Get the initialized instance
- `isFeatureServiceInitialized()` - Check if service is ready

### Renderer Process

Features can be accessed in the renderer process via:

1. **React Hooks:**
   - `useFeature(featureName)` - Check if a feature is enabled
   - `usePlatformFeature()` - Get current runtime platform
   - `useIsDesktop()` - Check if running on desktop platform

2. **Utility Functions:**
   - `checkFeature(featureName)` - Imperative feature check
   - `getPlatform()` - Get current platform imperatively

### Web Support

The service automatically works in both Electron and web environments. In web builds:
- All features return `false` by default
- Platform is always `'web'`

## Configuration

Features are configured via a YAML file with the following structure:

```yaml
Features:
  # Basic strategy - simple on/off toggle
  - Name: "feature-name"
    Strategies:
      - Type: Basic
        Enabled: true

  # Platform strategy - enabled based on runtime platform
  - Name: "desktop-only-feature"
    Strategies:
      - Type: Platform
        AvailableOn: [desktop]  # or [web], or [desktop, web]

  # Multiple strategies - ALL must return true (AND logic)
  - Name: "complex-feature"
    Strategies:
      - Type: Basic
        Enabled: true
      - Type: Platform
        AvailableOn: [desktop]
```

## Strategies

### Basic Strategy

Simple boolean toggle. The feature is enabled or disabled based on the `Enabled` value.

```yaml
Strategies:
  - Type: Basic
    Enabled: true
```

### Platform Strategy

Enables features based on the runtime platform (desktop or web).

```yaml
Strategies:
  - Type: Platform
    AvailableOn: [desktop]
```

### Combining Strategies

Multiple strategies can be combined. **ALL strategies must return true** for the feature to be enabled.

```yaml
# This feature is only enabled when:
# 1. Basic is set to true (can be used as a kill switch)
# 2. AND running on desktop platform
- Name: "desktop-beta-feature"
  Strategies:
    - Type: Basic
      Enabled: true
    - Type: Platform
      AvailableOn: [desktop]
```

## Usage

### 1. Initialize in Main Process

In your Electron main process, initialize the service before `initializeApp`:

```typescript
import { initFeatureService, initializeApp, logger } from 'electron-core-ui'
import { join } from 'path'
import { app } from 'electron'

// Get config path
function getFeaturesConfigPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    return join(app.getAppPath(), 'resources/features.yaml')
  }
  return join(process.resourcesPath, 'app-resources/features.yaml')
}

// Initialize service with 'desktop' platform
initFeatureService(getFeaturesConfigPath(), 'desktop')

// Then initialize app
initializeApp('MyApp', createWindow, resourcesPath)
```

### 2. Create Configuration File

Create `resources/features.yaml` in your application:

```yaml
Features:
  - Name: "new-ui"
    Strategies:
      - Type: Basic
        Enabled: true

  - Name: "desktop-feature"
    Strategies:
      - Type: Platform
        AvailableOn: [desktop]
```

### 3. Use in Renderer Components

```tsx
import { useFeature, StatusbarElement } from 'electron-core-ui/renderer'

const MyComponent: React.FC = () => {
  const { isEnabled, isLoading } = useFeature('new-ui')

  if (isLoading) return null
  if (!isEnabled) return null

  return <div>New UI Feature!</div>
}
```

## API Reference

### Types

```typescript
type FeaturePlatform = 'desktop' | 'web'
type FeatureStrategyType = 'Basic' | 'Platform'

interface BasicStrategy {
  Type: 'Basic'
  Enabled: boolean
}

interface PlatformStrategy {
  Type: 'Platform'
  AvailableOn: FeaturePlatform[]
}

type FeatureStrategy = BasicStrategy | PlatformStrategy

interface FeatureConfig {
  Name: string
  Strategies: FeatureStrategy[]
}
```

### Main Process API

```typescript
// Initialize service (call once at startup)
initFeatureService(configPath: string, platform?: FeaturePlatform): FeatureFlippingService

// Get service instance
getFeatureService(): FeatureFlippingService

// Check if initialized
isFeatureServiceInitialized(): boolean

// Service methods
service.isEnabled(featureName: string): boolean
service.getPlatform(): FeaturePlatform
service.listFeatures(): string[]
```

### Renderer API

```typescript
// Hooks
useFeature(featureName: string): { isEnabled: boolean, isLoading: boolean }
usePlatformFeature(): { platform: FeaturePlatform, isLoading: boolean }
useIsDesktop(): { isDesktop: boolean, isLoading: boolean }

// Utility functions
checkFeature(featureName: string): Promise<boolean>
getPlatform(): Promise<FeaturePlatform>
```

## Error Handling

- If a feature doesn't exist, `isEnabled` returns `false` and logs a warning
- If the config file doesn't exist, the service initializes with no features
- If a feature has no strategies, it returns `false` with a warning
- Unknown strategy types are logged as warnings and return `false`
