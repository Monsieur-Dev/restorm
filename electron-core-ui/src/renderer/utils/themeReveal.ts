import './themeReveal.css'

/**
 * Runs a theme-changing callback inside a circular reveal transition that
 * expands from a given screen-space anchor (typically the user's cursor).
 *
 * Backed by the View Transitions API (`document.startViewTransition`). On
 * platforms without support — or when the user has `prefers-reduced-motion`
 * set — the callback runs synchronously without animation and the function
 * returns a resolved promise.
 *
 * The actual animation is driven by CSS in `themeReveal.css`: when this
 * helper sets `--ecu-theme-reveal-x` / `--ecu-theme-reveal-y` on
 * `document.documentElement` and a view transition starts, the new-root
 * pseudo's `clip-path` expands from `circle(0 at x y)` to a corner-covering
 * circle, painting the new theme over the old.
 *
 * The CSS keyframes are bundled with this module — importing the helper
 * from `electron-core-ui/renderer` brings them along automatically.
 */
export interface ThemeRevealOrigin {
  /** Anchor X in viewport pixels (e.g. `event.clientX`). */
  x: number
  /** Anchor Y in viewport pixels (e.g. `event.clientY`). */
  y: number
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function viewportCenter(): ThemeRevealOrigin {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

/**
 * Module-level "pending origin" so click handlers can record where the
 * user clicked even when the actual theme apply runs asynchronously
 * later — e.g. when the click goes through a settings IPC pipeline that
 * eventually fires the `theme:changed` broadcast back to the renderer.
 *
 * Store the origin at click time, then consume it from the listener that
 * applies the theme so the circular reveal still anchors at the cursor.
 */
let pendingOrigin: ThemeRevealOrigin | null = null

export function setPendingThemeRevealOrigin(origin: ThemeRevealOrigin | null): void {
  pendingOrigin = origin
}

/**
 * Returns and clears the pending origin set by `setPendingThemeRevealOrigin`.
 * Returns `undefined` when nothing was queued so callers can spread it
 * straight into `runThemeRevealTransition` as the optional second arg.
 */
export function consumePendingThemeRevealOrigin(): ThemeRevealOrigin | undefined {
  const origin = pendingOrigin ?? undefined
  pendingOrigin = null
  return origin
}

/**
 * Runs `apply` inside a circular reveal centered on `origin`. Falls back to
 * a plain synchronous call when view transitions or motion are unavailable.
 *
 * @returns A promise that resolves once the transition (if any) has run to
 *          completion. Always resolves — never rejects — so callers can
 *          safely `await` without handling animation errors.
 */
export async function runThemeRevealTransition(
  apply: () => void | Promise<void>,
  origin?: ThemeRevealOrigin
): Promise<void> {
  if (typeof document === 'undefined') {
    await apply()
    return
  }

  // lib.dom types `startViewTransition` as always present, but it's a
  // Chromium-only API at runtime — feature-detect via property lookup.
  // Electron qualifies, but stay defensive so SSR / non-Chromium hosts
  // don't crash.
  const hasViewTransitions = 'startViewTransition' in document
  if (!hasViewTransitions || prefersReducedMotion()) {
    await apply()
    return
  }
  const startViewTransition = (
    document as Document & {
      startViewTransition: (callback: () => void | Promise<void>) => { finished: Promise<void> }
    }
  ).startViewTransition.bind(document)

  const root = document.documentElement
  const anchor = origin ?? viewportCenter()
  root.style.setProperty('--ecu-theme-reveal-x', `${anchor.x}px`)
  root.style.setProperty('--ecu-theme-reveal-y', `${anchor.y}px`)
  root.setAttribute('data-ecu-theme-reveal', 'active')

  try {
    const transition = startViewTransition(async () => {
      await apply()
    })
    await transition.finished
  } catch {
    // View transition rejected (e.g. concurrent transition); the theme
    // change still landed inside the callback, so swallow the rejection.
  } finally {
    root.removeAttribute('data-ecu-theme-reveal')
  }
}
