/**
 * Plan-derived pseudo-capabilities.
 *
 * Distinct from `Capability` in `authState.ts`, which is the CONTRACT with the
 * cloud backend — every string there must be minted into the entitlement JWT,
 * and one that isn't is granted to nobody. The ids below are never minted:
 * they are computed client-side from `AuthState.plan` and exist so a
 * plan-dependent rule can reuse the `capability`-tagged settings machinery
 * (`SettingDefinition.capability` → `GatedControl`'s visible-but-locked
 * treatment) without inventing a backend capability for it.
 *
 * Use one only when the rule is a pure function of the plan tier. Anything the
 * backend actually decides belongs in `Capability`.
 */

/**
 * Gates the ability to turn crash reporting OFF (`privacy:crashReports`).
 *
 * Locked for `community`, unlocked for every paid plan. Free accounts fund the
 * product with the diagnostics that keep it maintainable, so the toggle renders
 * greyed-with-upsell rather than hidden — the user can see the setting, its
 * value, and what a subscription would change. The main process applies the
 * same rule to `canSend('crash')`, so the locked control and the actual
 * behaviour can never diverge.
 */
export const CRASH_OPT_OUT_CAPABILITY = 'crash.optOut'

/**
 * Gates SERVING an API design as a mock: spinning up the design server.
 * Locked for `community`, unlocked for every paid plan. Deliberately NOT an
 * editing gate, and (Yoann, 2026-09-03) NOT a code-generation gate either:
 * the free tier designs freely AND generates code freely (from the official +
 * local templates) — what a subscription buys is PLAYING the design as a mock
 * (design server, 468.6). The org's SHARED templates are the separate
 * Enterprise gate (server-enforced). A pure function of the plan tier, hence a
 * pseudo-capability rather than a backend-minted one.
 */
export const DESIGN_RUN_CAPABILITY = 'design.run'

/** The one shared reading of the design-serve gate, so the serve button and the
 * settings machinery can never disagree on who may serve a design as a mock.
 * (Code generation is NOT gated — it is free on every plan.) */
export function isDesignRunLocked(authState: { plan?: string | null | undefined }): boolean {
  return (authState.plan ?? 'community') === 'community'
}
