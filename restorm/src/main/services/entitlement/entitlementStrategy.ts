/**
 * Entitlement strategy factory — bridges ECUI's FeatureFlippingService to
 * restorm's live EntitlementService.
 *
 * Register once, after both services are initialized:
 *   featureService.registerStrategy(
 *     'Entitlement',
 *     createEntitlementEvaluator(() => entitlementService.getState())
 *   )
 *
 * YAML shape in features.yaml:
 *   - Name: "mcp.pro"
 *     Strategies:
 *       - Type: Entitlement
 *         RequiredCapabilities: ['mcp.pro']   # all must be present; empty = always true
 *
 * The evaluator is called live on every `isEnabled()` invocation — no internal
 * caching — so it always reflects the current auth snapshot. The EntitlementService
 * derives state from a verified JWT snapshot that does not change between calls,
 * so repeated `getState()` is cheap.
 *
 * Reactivity: when the entitlement changes, `authComposition.ts` calls
 * `featureService.invalidate()` which fires `feature:changed` to all renderers,
 * causing any `useFeature` subscriber to re-fetch and re-render.
 */

import type { CustomStrategyConfig, CustomStrategyEvaluator } from 'electron-core-ui/main'
import type { AuthState } from '../../../shared/auth/authState'

/** YAML shape for the `Type: Entitlement` custom strategy. */
export interface EntitlementStrategyConfig extends CustomStrategyConfig {
  Type: 'Entitlement'
  /**
   * Every capability string listed here must be present in the live
   * `AuthState.capabilities` for the strategy to return `true`. An empty
   * list always returns `true` (useful for a "just signed-in" gate with no
   * plan constraint). Must stay in lock-step with the `Capability` union in
   * `restorm/src/shared/auth/authState.ts` and the cloud backend contract.
   */
  RequiredCapabilities: string[]
}

/**
 * Returns a `CustomStrategyEvaluator` for the `'Entitlement'` strategy type.
 * `getState` is injected so the factory stays testable without mocking the
 * full EntitlementService — pass `() => entitlementService.getState()`.
 */
export function createEntitlementEvaluator(getState: () => AuthState): CustomStrategyEvaluator {
  return (strategyConfig: CustomStrategyConfig): boolean => {
    const config = strategyConfig as EntitlementStrategyConfig
    const required = Array.isArray(config.RequiredCapabilities) ? config.RequiredCapabilities : []
    const { capabilities } = getState()
    return required.every((cap) => capabilities.includes(cap))
  }
}
