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
 * Gates EDITING an API design (the Design tab and every design mutation
 * surface). Locked for `community`, unlocked for every paid plan: the
 * free tier can open a design and read everything — the gate renders
 * editors greyed-with-upsell — while designing is a paid feature. A pure
 * function of the plan tier, hence a pseudo-capability rather than a
 * backend-minted one.
 */
export const DESIGN_EDIT_CAPABILITY = 'design.edit'

/** The one shared reading of the design-edit gate, so the Design tab,
 * the settings machinery and any future mutation surface can never
 * disagree on who may edit. */
export function isDesignEditLocked(authState: { plan?: string | null | undefined }): boolean {
  return (authState.plan ?? 'community') === 'community'
}
