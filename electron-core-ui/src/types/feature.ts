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

/** Built-in strategy type literals. */
export type BuiltinFeatureStrategyType = 'Basic' | 'Platform' | 'Environment'

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
 * Config shape accepted for any custom strategy type registered at runtime.
 * The `Type` discriminator must not collide with the built-in names
 * (Basic, Platform, Environment). All additional fields are passed verbatim
 * to the evaluator the app registered for that type.
 */
export interface CustomStrategyConfig {
  Type: string
  [key: string]: unknown
}

/**
 * Evaluator function injected by the host app for a custom strategy type.
 *
 * Called on every `isEnabled()` invocation — must be fast (no I/O; no async).
 * Live state (e.g. entitlement plan, user role) is accessed via a closure
 * the evaluator holds, not through the config object. ECUI stays generic:
 * it calls the evaluator and relies on the host to provide the semantics.
 */
export type CustomStrategyEvaluator = (strategyConfig: CustomStrategyConfig) => boolean

/**
 * Union type for all strategy configurations (built-in + custom).
 * Custom types pass through YAML validation and are dispatched to the
 * evaluator registered via {@link FeatureFlippingService.registerStrategy}.
 */
export type FeatureStrategy = BasicStrategy | PlatformStrategy | EnvironmentStrategy | CustomStrategyConfig

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
  /** Subscribe to feature state changes pushed from the main process.
   * Returns an unsubscribe function. */
  onChanged: (callback: () => void) => () => void
}
