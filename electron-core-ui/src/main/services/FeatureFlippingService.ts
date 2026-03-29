import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'
import type {
  FeatureConfig,
  FeaturePlatform,
  FeatureStrategy,
  BasicStrategy,
  PlatformStrategy
} from '../../types/feature'
import { logger } from './LoggerService'
import { FileSystemError, errorMeta } from '../../errors'
import { featuresYamlConfigSchema } from '../schemas/configSchemas'

/**
 * FeatureFlippingService manages feature flags with configurable strategies
 * 
 * Supported strategies:
 * - Basic: Simple on/off toggle defined in config
 * - Platform: Enables feature based on runtime platform (desktop/web)
 * 
 * Multiple strategies can be combined - ALL must return true for feature to be enabled (AND logic)
 * 
 * Configuration is loaded from a YAML file provided by the consuming application
 */
export class FeatureFlippingService {
  private features = new Map<string, FeatureConfig>()
  private platform: FeaturePlatform

  constructor(featuresConfigPath: string, platform: FeaturePlatform = 'desktop') {
    this.platform = platform
    this.loadFeatures(featuresConfigPath)
  }

  /**
   * Load features configuration from YAML file
   */
  private loadFeatures(configPath: string): void {
    if (!existsSync(configPath)) {
      logger.warn(`Features configuration file not found: ${configPath}`)
      return
    }

    try {
      const content = readFileSync(configPath, 'utf-8')
      const raw = yaml.load(content)
      const parsed = featuresYamlConfigSchema.safeParse(raw)
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => i.message).join('; ')
        logger.warn('Invalid features configuration', { issues })
        return
      }
      const config = parsed.data

      for (const feature of config.Features) {
        this.features.set(feature.Name, feature)
      }

      logger.info(`FeatureFlippingService: Loaded ${String(this.features.size)} features`)
    } catch (error) {
      const wrappedError = new FileSystemError('Failed to load features configuration', 'FS_READ_FAILED', { cause: error })
      logger.error('Failed to load features configuration', errorMeta(wrappedError))
    }
  }

  /**
   * Check if a feature is enabled
   * Returns false and logs a warning if the feature doesn't exist
   * All strategies must return true for the feature to be enabled
   */
  public isEnabled(featureName: string): boolean {
    const feature = this.features.get(featureName)

    if (!feature) {
      logger.warn(`Feature not found: "${featureName}". Available features: ${Array.from(this.features.keys()).join(', ') || 'none'}`)
      return false
    }

    return this.evaluateStrategies(feature)
  }

  /**
   * Evaluate all strategies for a feature
   * All strategies must return true (AND logic)
   */
  private evaluateStrategies(feature: FeatureConfig): boolean {
    // If no strategies defined, feature is disabled
    if (feature.Strategies.length === 0) {
      logger.warn(`Feature "${feature.Name}" has no strategies defined, returning false`)
      return false
    }

    // All strategies must return true
    for (const strategy of feature.Strategies) {
      if (!this.evaluateStrategy(strategy, feature.Name)) {
        return false
      }
    }

    return true
  }

  /**
   * Evaluate a single strategy
   */
  private evaluateStrategy(strategy: FeatureStrategy, featureName: string): boolean {
    switch (strategy.Type) {
      case 'Basic':
        return this.evaluateBasicStrategy(strategy)
      case 'Platform':
        return this.evaluatePlatformStrategy(strategy)
      default:
        logger.warn(`Unknown strategy type for feature "${featureName}": ${(strategy as { Type: string }).Type}`)
        return false
    }
  }

  /**
   * Basic strategy: return the configured enabled value
   */
  private evaluateBasicStrategy(strategy: BasicStrategy): boolean {
    return strategy.Enabled
  }

  /**
   * Platform strategy: check if current platform is in the allowed list
   */
  private evaluatePlatformStrategy(strategy: PlatformStrategy): boolean {
    return strategy.AvailableOn.includes(this.platform)
  }

  /**
   * Get the current runtime platform
   */
  public getPlatform(): FeaturePlatform {
    return this.platform
  }

  /**
   * Get all configured features (for debugging)
   */
  public listFeatures(): string[] {
    return Array.from(this.features.keys())
  }
}

// Singleton instance
let featureServiceInstance: FeatureFlippingService | null = null

/**
 * Initialize the singleton instance of FeatureFlippingService
 * Must be called before getFeatureService()
 */
export function initFeatureService(
  featuresConfigPath: string,
  platform: FeaturePlatform = 'desktop'
): FeatureFlippingService {
  if (featureServiceInstance) {
    logger.warn('FeatureFlippingService already initialized, returning existing instance')
    return featureServiceInstance
  }

  logger.info('FeatureFlippingService: Creating singleton instance...')
  featureServiceInstance = new FeatureFlippingService(featuresConfigPath, platform)
  return featureServiceInstance
}

/**
 * Get the singleton instance of FeatureFlippingService
 * Throws if not initialized
 */
export function getFeatureService(): FeatureFlippingService {
  if (!featureServiceInstance) {
    throw new Error('FeatureFlippingService not initialized. Call initFeatureService() first.')
  }
  return featureServiceInstance
}

/**
 * Check if the service has been initialized
 */
export function isFeatureServiceInitialized(): boolean {
  return featureServiceInstance !== null
}
