/**
 * Feature Flipping types and definitions
 *
 * Features can have multiple strategies that must ALL return true
 * for the feature to be considered enabled (AND logic).
 */

/**
 * Available platforms for platform-based strategy
 */
export type FeaturePlatform = 'desktop' | 'web'

/**
 * Build environment for environment-based strategy. `dev` covers any
 * unpackaged / development run (electron-vite dev, `pnpm dev`, the
 * tests harness); `prod` covers packaged binaries shipped to users.
 */
export type FeatureEnvironment = 'dev' | 'prod'

/**
 * Available strategy types
 */
export type FeatureStrategyType = 'Basic' | 'Platform' | 'Environment'

/**
 * Basic strategy - simple on/off toggle
 */
export interface BasicStrategy {
  Type: 'Basic'
  Enabled: boolean
}

/**
 * Platform strategy - enabled based on runtime platform (desktop/web)
 */
export interface PlatformStrategy {
  Type: 'Platform'
  AvailableOn: FeaturePlatform[]
}

/**
 * Environment strategy - enabled based on build environment.
 * `AvailableIn: [dev]` produces a feature that's only on in
 * unpackaged builds (debug-only UI, internal CTAs, etc).
 */
export interface EnvironmentStrategy {
  Type: 'Environment'
  AvailableIn: FeatureEnvironment[]
}

/**
 * Union type for all strategy configurations
 */
export type FeatureStrategy = BasicStrategy | PlatformStrategy | EnvironmentStrategy

/**
 * Feature configuration with multiple strategies
 * All strategies must return true for the feature to be enabled
 */
export interface FeatureConfig {
  Name: string
  Strategies: FeatureStrategy[]
}

/**
 * YAML structure for features configuration file
 */
export interface FeaturesYamlConfig {
  Features: FeatureConfig[]
}

/**
 * Runtime context for evaluating strategies
 */
export interface RuntimeContext {
  platform: FeaturePlatform
  environment: FeatureEnvironment
}

/**
 * Feature service API exposed to renderer
 */
export interface FeatureApi {
  isEnabled: (featureName: string) => Promise<boolean>
  getPlatform: () => Promise<FeaturePlatform>
  getEnvironment: () => Promise<FeatureEnvironment>
}
