import { readFileSync, existsSync } from 'fs'
import yaml from 'js-yaml'
import type {
  CustomStrategyConfig,
  CustomStrategyEvaluator,
  FeatureConfig,
  FeatureEnvironment,
  FeaturePlatform,
  FeatureStrategy,
  BasicStrategy,
  EnvironmentStrategy,
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
 * - Environment: Enables feature based on build environment (dev/prod)
 *
 * Multiple strategies can be combined - ALL must return true for feature to be enabled (AND logic)
 *
 * Configuration is loaded from a YAML file provided by the consuming application
 */
export class FeatureFlippingService {
  private features = new Map<string, FeatureConfig>()
  private platform: FeaturePlatform
  private environment: FeatureEnvironment
  /** Evaluators for custom strategy types registered by the host app. */
  private customEvaluators = new Map<string, CustomStrategyEvaluator>()
  /** Listeners notified when feature evaluations may have changed. */
  private listeners = new Set<() => void>()

  constructor(featuresConfigPath: string, platform: FeaturePlatform = 'desktop', environment: FeatureEnvironment = 'prod') {
    this.platform = platform
    this.environment = environment
    this.loadFeatures(featuresConfigPath)
  }

  /**
   * Load features configuration from YAML file
   */
  private loadFeatures(configPath: string): void {
    this.mergeConfigFromFile(configPath)
    logger.info(`FeatureFlippingService: Loaded ${String(this.features.size)} features`)
  }

  /**
   * Load an additional YAML config and merge it into existing features (last wins by Name)
   */
  public loadAdditionalConfig(configPath: string): void {
    const before = this.features.size
    this.mergeConfigFromFile(configPath)
    const added = this.features.size - before
    logger.info(`FeatureFlippingService: Merged additional config, ${String(added)} new feature(s), ${String(this.features.size)} total`)
  }

  /**
   * Parse a YAML config file and merge its features into the Map (last wins by Name)
   */
  private mergeConfigFromFile(configPath: string): void {
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
   * Evaluate a single strategy.
   *
   * Built-in types (Basic / Platform / Environment) are handled inline.
   * Any other `Type` is dispatched to an evaluator registered via
   * {@link registerStrategy}; if none is found the feature evaluates to
   * `false` and a warning is logged (misconfigured YAML or a strategy
   * type injected after the feature was queried).
   */
  private evaluateStrategy(strategy: FeatureStrategy, featureName: string): boolean {
    switch (strategy.Type) {
      case 'Basic':
        return this.evaluateBasicStrategy(strategy as BasicStrategy)
      case 'Platform':
        return this.evaluatePlatformStrategy(strategy as PlatformStrategy)
      case 'Environment':
        return this.evaluateEnvironmentStrategy(strategy as EnvironmentStrategy)
      default: {
        const evaluator = this.customEvaluators.get(strategy.Type)
        if (evaluator) {
          return evaluator(strategy as CustomStrategyConfig)
        }
        logger.warn(`Unknown strategy type for feature "${featureName}": ${strategy.Type} (no evaluator registered)`)
        return false
      }
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
   * Environment strategy: check if the current build environment is
   * in the allowed list. Used to ship dev-only debug surfaces (test
   * buttons, internal panels, hidden CTAs) that disappear from
   * packaged production builds without code-stripping.
   */
  private evaluateEnvironmentStrategy(strategy: EnvironmentStrategy): boolean {
    return strategy.AvailableIn.includes(this.environment)
  }

  /**
   * Register an evaluator for a custom strategy type.
   *
   * The `type` string must match the `Type` field in the YAML config.
   * Built-in names (`Basic`, `Platform`, `Environment`) are reserved;
   * registering them here is silently ignored (the switch handles them).
   *
   * Safe to call after `initFeatureService` returns — the service dispatches
   * to evaluators on every `isEnabled()` call, so late registration is fine
   * as long as it happens before the first `isEnabled()` for that feature.
   */
  public registerStrategy(type: string, evaluator: CustomStrategyEvaluator): void {
    this.customEvaluators.set(type, evaluator)
  }

  /**
   * Subscribe to feature state invalidations.
   *
   * The listener is called whenever external state that influences custom
   * strategies may have changed (e.g. an entitlement refresh). `isEnabled()`
   * already re-evaluates on every call, so the listener's job is to notify
   * downstream consumers (e.g. push an IPC `feature:changed` event) so they
   * re-query the service.
   *
   * @returns An unsubscribe function that removes the listener.
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return (): void => { this.listeners.delete(listener) }
  }

  /**
   * Signal that external state has changed and feature evaluations should be
   * re-checked. Fires all registered listeners synchronously.
   *
   * Called by the host app when a state change that affects custom strategy
   * evaluation occurs (e.g. the entitlement service emits a new auth state).
   */
  public invalidate(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  /**
   * Get the current runtime platform
   */
  public getPlatform(): FeaturePlatform {
    return this.platform
  }

  /**
   * Get the current build environment (`dev` for unpackaged runs,
   * `prod` for packaged binaries).
   */
  public getEnvironment(): FeatureEnvironment {
    return this.environment
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

/** Options for {@link initFeatureService}. */
export interface InitFeatureServiceOptions {
  /** Base feature config (shipped defaults). */
  defaultConfigPath: string
  /** Optional app-level overrides layered over the defaults. */
  appConfigPath?: string | undefined
  /** Target platform (default `'desktop'`). */
  platform?: FeaturePlatform | undefined
  /** Target environment (default `'prod'` — packaged builds get the conservative default;
   * pass `app.isPackaged ? 'prod' : 'dev'` for dev-only surfaces). */
  environment?: FeatureEnvironment | undefined
}

/**
 * Initialize the singleton instance of FeatureFlippingService.
 * Must be called before getFeatureService().
 *
 * Takes an options object so each field is named — the previous positional
 * form disambiguated "is arg 2 a path or a platform?" by value-sniffing
 * `'desktop'`/`'web'`, which silently mis-parsed an appConfigPath literally
 * named "web".
 */
export function initFeatureService(options: InitFeatureServiceOptions): FeatureFlippingService {
  if (featureServiceInstance) {
    logger.warn('FeatureFlippingService already initialized, returning existing instance')
    return featureServiceInstance
  }

  const { defaultConfigPath, appConfigPath, platform = 'desktop', environment = 'prod' } = options

  logger.info('FeatureFlippingService: Creating singleton instance...')
  featureServiceInstance = new FeatureFlippingService(defaultConfigPath, platform, environment)

  if (appConfigPath) {
    featureServiceInstance.loadAdditionalConfig(appConfigPath)
  }

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

/**
 * Reset the singleton instance (for testing only)
 */
export function resetFeatureService(): void {
  featureServiceInstance = null
}
