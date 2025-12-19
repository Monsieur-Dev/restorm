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
 * Available strategy types
 */
export type FeatureStrategyType = 'Basic' | 'Platform'

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
 * Union type for all strategy configurations
 */
export type FeatureStrategy = BasicStrategy | PlatformStrategy

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
}

/**
 * Feature service API exposed to renderer
 */
export interface FeatureApi {
  isEnabled: (featureName: string) => Promise<boolean>
  getPlatform: () => Promise<FeaturePlatform>
}
