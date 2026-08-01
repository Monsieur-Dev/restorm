/**
 * Restorm-specific feature-flag accessors.
 *
 * These helpers wrap `getFeatureService().isEnabled(name)` for the
 * narrow set of flags the main process consults at IPC entry points.
 * Keeping them here (rather than scattering `isEnabled('…')` through
 * IPC handlers) means the unit tests can dependency-inject the
 * feature-service interface without dragging the full Electron app
 * boot through them.
 */

interface FeatureServiceLike {
  isEnabled(featureName: string): boolean
}

/** The flag name used by the workbench tab-detach pathway. Kept as
 * a constant so renderer + main + features.yaml stay in sync.
 *
 * @see restorm/resources/features.yaml
 * @see restorm/src/renderer/src/components/MainView/Workbench/RestormWorkbench.tsx
 */
export const TAB_DETACH_FEATURE = 'workbench.tabDetach'

/**
 * Whether the workbench tab-detach pathway is enabled.
 *
 * The pathway is gated end-to-end:
 * - Renderer: dragging a tab outside the window bounds is a no-op
 *   when the flag is off (see `EditorTabs.disableTabDetach` in
 *   electron-core-ui).
 * - Main process (this helper, called from
 *   `restorm:open-editor`): the IPC handler refuses to spawn a
 *   detached editor window when the flag is off, even if a renderer
 *   somehow bypasses the renderer-side gate.
 *
 * Returns `false` when the feature service is not initialised yet
 * (i.e. very early boot) — the flag-off default applies.
 */
export function isTabDetachEnabled(featureService: FeatureServiceLike): boolean {
  return featureService.isEnabled(TAB_DETACH_FEATURE)
}
