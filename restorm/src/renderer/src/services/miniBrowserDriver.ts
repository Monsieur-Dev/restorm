import type { MiniBrowserDriver } from 'electron-core-ui/renderer'

/**
 * Adapter that wires ECUI's generic `MiniBrowserPanel` to restorm's
 * main-process `MiniBrowserService` via the preload bridge. The panel
 * is library code (no restorm-specific imports allowed); restorm
 * stays the only place that knows about `window.restorm.miniBrowser`.
 *
 * `window.restorm` is typed as optional because the renderer also
 * loads outside an Electron host in some test paths. At runtime in
 * the real app the bridge is always present; for the no-preload case
 * (web mode, unit tests) we surface a no-op driver so the panel can
 * still mount without crashing — it just won't show any embedded
 * page.
 */
const bridge = (): Window['restorm'] | null => {
  if (typeof window === 'undefined') return null
  return window.restorm ?? null
}

const ok = { ok: true } as const
const noopUnsub = (): void => { /* no preload bridge in this renderer */ }

export const miniBrowserDriver: MiniBrowserDriver = {
  create: (tabId, initialUrl) => bridge()?.miniBrowser.create(tabId, initialUrl) ?? Promise.resolve(ok),
  destroy: (tabId) => bridge()?.miniBrowser.destroy(tabId) ?? Promise.resolve(ok),
  setBounds: (tabId, bounds) => bridge()?.miniBrowser.setBounds(tabId, bounds) ?? Promise.resolve(ok),
  navigate: (tabId, url) => bridge()?.miniBrowser.navigate(tabId, url) ?? Promise.resolve(ok),
  reload: (tabId) => bridge()?.miniBrowser.reload(tabId) ?? Promise.resolve(ok),
  goBack: (tabId) => bridge()?.miniBrowser.goBack(tabId) ?? Promise.resolve(ok),
  goForward: (tabId) => bridge()?.miniBrowser.goForward(tabId) ?? Promise.resolve(ok),
  getState: (tabId) => bridge()?.miniBrowser.getState(tabId) ?? Promise.resolve(null),
  capture: (tabId) => bridge()?.miniBrowser.capture(tabId) ?? Promise.resolve(null),
  onDidNavigate: (callback) => bridge()?.miniBrowser.onDidNavigate(callback) ?? noopUnsub,
  onDidStopLoading: (callback) => bridge()?.miniBrowser.onDidStopLoading(callback) ?? noopUnsub,
  onUserInteraction: (callback) => bridge()?.miniBrowser.onUserInteraction(callback) ?? noopUnsub
}
