/**
 * MiniBrowserService — owns a `WebContentsView` per Mini-Browser tab.
 *
 * Why a main-process service instead of a `<webview>` tag in the
 * renderer:
 *
 * The renderer can host a `<webview>` element to embed third-party
 * origins (cookies / localStorage / IndexedDB scoped to the embedded
 * page, not partitioned by the host frame). That worked, but Chromium
 * tears down the guest process the instant the `<webview>` element
 * traverses a DOM re-parenting — including a pure `appendChild`-move
 * from one parent to another inside the same document, which the DOM
 * spec treats as a connectedness-preserving move. The workbench's
 * cross-group tab move re-parents the tab's host node, so the
 * MiniBrowser webview reloaded on every drag between groups (the
 * page-state, scroll, in-flight requests, and any login session
 * inside the embedded page were lost).
 *
 * `WebContentsView` lives in the main process. Its content is owned by
 * Electron, not the renderer's DOM tree. The renderer no longer
 * positions the embedded page via the React tree; instead the panel
 * tracks the layout rect of its placeholder slot (`ResizeObserver`)
 * and pushes `setBounds(rect)` to this service. Moving the tab
 * between groups is just another bounds update — the WebContentsView's
 * own lifetime is decoupled from the React-tree relocations.
 *
 * Lifecycle:
 *   create(tabId, ownerWindow, initialUrl?)  →  view attached to
 *      the owner window's contentView, ready to receive `setBounds`.
 *   setBounds(tabId, rect)                   →  position over the
 *      slot. Off-screen rects (zero size or negative coords) hide
 *      the view by setting `setVisible(false)` so the page doesn't
 *      paint behind a collapsed pane.
 *   navigate(tabId, url)                     →  `loadURL(url)`.
 *   reload / goBack / goForward              →  delegate to the
 *      contents.
 *   destroy(tabId)                           →  remove from window,
 *      close the contents, free the slot in the map.
 *
 * Events flowing back to the renderer (via the owner window's
 * webContents):
 *   `miniBrowser:did-navigate`         { tabId, url }
 *   `miniBrowser:did-navigate-in-page` { tabId, url } (SPA route changes)
 *   `miniBrowser:did-stop-loading`     { tabId, canGoBack, canGoForward }
 *   `miniBrowser:user-interaction`     { tabId } (used by the panel
 *      to bubble a click event into the workbench's "focus the
 *      owning group" listener — replaces the previous
 *      console-message bridge from the `<webview>` era)
 */

import { BrowserWindow, WebContentsView } from 'electron'
import { logger } from 'electron-core-ui/main'
import { geolocationService } from './geolocation/GeolocationService'

/**
 * The mini-browser embeds web content: http(s) pages, and a LOCAL html page
 * (`file://`) — a recording session may listen to a page under development
 * before it is served. Every other scheme (javascript:, data:, blob:, …) is
 * rejected so a navigation can't run a `javascript:` payload in the
 * embedded context. A `file://` page still runs sandboxed with no node
 * integration; it reads no more than a browser opening the same file would.
 */
function isEmbeddableUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:'
  } catch {
    return false
  }
}

interface MiniBrowserViewState {
	view: WebContentsView
	ownerWindow: BrowserWindow
	lastBounds: { x: number; y: number; width: number; height: number } | null
	isAttached: boolean
	// Mirror of the view's `setVisible` state so visibility toggles are
	// idempotent (Electron has no getter). A freshly created view starts
	// hidden until the renderer pushes its first non-zero rect.
	isVisible: boolean
}

export interface MiniBrowserBounds {
	x: number
	y: number
	width: number
	height: number
}

class MiniBrowserService {
	private views = new Map<string, MiniBrowserViewState>()
	// Owner windows we've already wired a navigation-start listener on,
	// so the listener is attached at most once per window regardless of
	// how many Mini-Browser tabs it hosts. Entries are dropped when the
	// window is destroyed.
	private navHookedWindows = new WeakSet<BrowserWindow>()

	/**
	 * Create a `WebContentsView` for a Mini-Browser tab. Idempotent — a
	 * second call for the same `tabId` is a no-op (returns the existing
	 * view) so a React StrictMode double-mount or a redundant renderer
	 * subscription doesn't spawn a second guest.
	 */
	create(tabId: string, ownerWindow: BrowserWindow, initialUrl?: string): void {
		const existing = this.views.get(tabId)
		if (existing) {
			// Same owner window: nothing to do. Different owner: relocate.
			if (existing.ownerWindow !== ownerWindow) {
				this.relocateToWindow(tabId, ownerWindow)
			}
			if (initialUrl && existing.view.webContents.getURL() === '' && initialUrl !== '' && isEmbeddableUrl(initialUrl)) {
				void existing.view.webContents.loadURL(initialUrl).catch((err: unknown) => {
					logger.warn('[MiniBrowserService] initial loadURL failed', { tabId, url: initialUrl, error: String(err) })
				})
			}
			return
		}
		const view = new WebContentsView({
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true
			}
		})
		// White matches the renderer's tab background — avoids a flash
		// of transparent compositing artefact between the moment the
		// view is attached and its first paint.
		view.setBackgroundColor('#ffffff')
		// Start hidden: the view has no bounds yet, and the renderer's
		// layout effect pushes the real rect immediately after `create`.
		// Hiding until then avoids a one-frame flash of an unpositioned
		// (0,0)-anchored view.
		view.setVisible(false)
		ownerWindow.contentView.addChildView(view)
		const state: MiniBrowserViewState = {
			view,
			ownerWindow,
			lastBounds: null,
			isAttached: true,
			isVisible: false
		}
		this.views.set(tabId, state)
		this.wireEvents(tabId, state)
		// The user's position (when shared) reaches the page through this view.
		geolocationService.track(view.webContents)
		this.ensureWindowNavHidden(ownerWindow)
		// Tear the view down when its owner window closes — the renderer's
		// unmount cleanup never runs on a hard window close, so without
		// this the WebContentsView (and its guest process) leaks.
		ownerWindow.once('closed', () => { this.destroyAllForWindow(ownerWindow) })
		if (initialUrl) {
			if (isEmbeddableUrl(initialUrl)) {
				void view.webContents.loadURL(initialUrl).catch((err: unknown) => {
					logger.warn('[MiniBrowserService] initial loadURL failed', { tabId, url: initialUrl, error: String(err) })
				})
			} else {
				logger.warn('[MiniBrowserService] blocked non-embeddable initial URL', { tabId, url: initialUrl })
			}
		}
	}

	/**
	 * The web contents behind a Mini-Browser tab, for a caller that needs
	 * to observe it (the recording engine attaches its CDP debugger here).
	 * `null` when the tab has no view (never created, or destroyed).
	 */
	getWebContents(tabId: string): Electron.WebContents | null {
		const state = this.views.get(tabId)
		if (!state || state.view.webContents.isDestroyed()) return null
		return state.view.webContents
	}

	/**
	 * Move the view to a different owner window. Used when the user
	 * detaches the tab into a new window (the cross-group drag inside
	 * the same window doesn't touch this — `setBounds` covers that).
	 */
	private relocateToWindow(tabId: string, newOwner: BrowserWindow): void {
		const state = this.views.get(tabId)
		if (!state) return
		if (state.ownerWindow === newOwner) return
		if (state.isAttached) {
			state.ownerWindow.contentView.removeChildView(state.view)
		}
		newOwner.contentView.addChildView(state.view)
		state.ownerWindow = newOwner
		state.isAttached = true
		this.ensureWindowNavHidden(newOwner)
	}

	/**
	 * Push a new layout rect for the view. Coords are in the owner
	 * window's content coordinate space (DIP, same as the renderer's
	 * `getBoundingClientRect`). A zero-or-negative-size rect hides the
	 * view via `setVisible(false)` so a collapsed pane doesn't keep
	 * paint cycles running behind itself.
	 */
	setBounds(tabId: string, bounds: MiniBrowserBounds): void {
		const state = this.views.get(tabId)
		if (!state) {
			logger.warn('[MiniBrowserService] setBounds: unknown tabId', { tabId, bounds })
			return
		}
		// The view may have been torn down (owner window closed) between
		// the renderer's last layout tick and this call — touching a
		// destroyed WebContentsView throws.
		if (state.view.webContents.isDestroyed()) return
		const rounded = {
			x: Math.round(bounds.x),
			y: Math.round(bounds.y),
			width: Math.max(0, Math.round(bounds.width)),
			height: Math.max(0, Math.round(bounds.height))
		}
		// Reconcile visibility on EVERY call, even when the rect is
		// unchanged: a zero-size rect (collapsed pane, tab switched away,
		// or the renderer's overlay/drag hide-path) hides the view via
		// `setVisible(false)` so it stops compositing above the renderer;
		// any non-zero rect shows it again. This must run before the
		// bounds-dedup early-return below — otherwise a view hidden out of
		// band (e.g. `hideAllForWindow` on a renderer refresh) would never
		// be re-shown when the remounted renderer re-pushes the SAME rect
		// it last sent.
		this.setViewVisible(state, rounded.width > 0 && rounded.height > 0)
		const prev = state.lastBounds
		if (prev?.x === rounded.x && prev.y === rounded.y && prev.width === rounded.width && prev.height === rounded.height) {
			return
		}
		state.view.setBounds(rounded)
		state.lastBounds = rounded
	}

	/**
	 * Show / hide a view via `setVisible`, idempotently. Hiding stops the
	 * native `WebContentsView` from compositing above the renderer —
	 * used both for collapsed/zero-size slots and, crucially, while the
	 * renderer is reloading (`hideAllForWindow`) so the embedded page
	 * doesn't keep painting on screen after the rest of the UI is gone.
	 */
	private setViewVisible(state: MiniBrowserViewState, visible: boolean): void {
		if (state.isVisible === visible) return
		state.view.setVisible(visible)
		state.isVisible = visible
	}

	/**
	 * Hide every view owned by `ownerWindow`. Wired to the window's
	 * top-frame navigation start: when the renderer reloads (Cmd+R,
	 * DevTools reload, a programmatic `location.reload()`, or crash
	 * recovery), it navigates away WITHOUT running React unmount cleanup,
	 * so the main-process views would otherwise keep painting over the
	 * blank/reloading renderer. Hiding here clears them instantly; once
	 * the renderer re-mounts, the panel's layout effect re-pushes real
	 * bounds through `setBounds`, which re-shows each view at the correct
	 * position.
	 */
	private hideAllForWindow(ownerWindow: BrowserWindow): void {
		for (const state of this.views.values()) {
			if (state.ownerWindow === ownerWindow && state.isAttached) {
				this.setViewVisible(state, false)
			}
		}
	}

	/**
	 * Tear down every view owned by a window that just closed. The
	 * renderer never runs its unmount cleanup on a hard window close, so
	 * without this each WebContentsView (and its guest process) would
	 * leak for the lifetime of the app.
	 */
	private destroyAllForWindow(ownerWindow: BrowserWindow): void {
		for (const [tabId, state] of this.views) {
			if (state.ownerWindow === ownerWindow) this.destroy(tabId)
		}
	}

	/**
	 * Attach a one-time-per-window listener that hides this window's
	 * Mini-Browser views the instant its top frame starts navigating —
	 * i.e. on any renderer reload. `did-start-navigation` fires for the
	 * main frame before the old document tears down, so the native views
	 * disappear together with the rest of the UI instead of lingering on
	 * the reloading page. The remounted renderer restores them via
	 * `setBounds`. The hook is idempotent (guarded by `navHookedWindows`)
	 * and self-removes on window destroy.
	 */
	private ensureWindowNavHidden(ownerWindow: BrowserWindow): void {
		if (this.navHookedWindows.has(ownerWindow)) return
		this.navHookedWindows.add(ownerWindow)
		const wc = ownerWindow.webContents
		wc.on('did-start-navigation', (details) => {
			// Only a real main-frame document load should hide the views;
			// ignore sub-frame loads and same-document (history / hash /
			// pushState) changes, which don't blank the renderer.
			if (details.isMainFrame && !details.isSameDocument) {
				this.hideAllForWindow(ownerWindow)
			}
		})
		wc.once('destroyed', () => {
			this.navHookedWindows.delete(ownerWindow)
		})
	}

	navigate(tabId: string, url: string): void {
		const state = this.views.get(tabId)
		if (!state) return
		if (!isEmbeddableUrl(url)) {
			logger.warn('[MiniBrowserService] blocked non-embeddable navigation', { tabId, url })
			return
		}
		void state.view.webContents.loadURL(url).catch((err: unknown) => {
			logger.warn('[MiniBrowserService] loadURL failed', { tabId, url, error: String(err) })
		})
	}

	reload(tabId: string): void {
		const state = this.views.get(tabId)
		if (!state) return
		state.view.webContents.reload()
	}

	goBack(tabId: string): void {
		const state = this.views.get(tabId)
		if (!state) return
		const nav = state.view.webContents.navigationHistory
		if (nav.canGoBack()) nav.goBack()
	}

	goForward(tabId: string): void {
		const state = this.views.get(tabId)
		if (!state) return
		const nav = state.view.webContents.navigationHistory
		if (nav.canGoForward()) nav.goForward()
	}

	/**
	 * Tear down the view: remove from the owner window and close the
	 * contents. Called when the Mini-Browser tab closes for good — NOT
	 * on cross-group moves (those are pure `setBounds` updates), and
	 * NOT on temporary unmount (e.g. workbench rerender churn): the
	 * renderer panel only calls this on its final unmount.
	 */
	destroy(tabId: string): void {
		const state = this.views.get(tabId)
		if (!state) return
		try {
			if (state.isAttached) {
				state.ownerWindow.contentView.removeChildView(state.view)
				state.isAttached = false
			}
			if (!state.view.webContents.isDestroyed()) {
				state.view.webContents.close()
			}
		} catch (err) {
			logger.warn('[MiniBrowserService] destroy failed', { tabId, error: String(err) })
		}
		this.views.delete(tabId)
	}

	/**
	 * Take a PNG snapshot of the current page and return it as a data
	 * URL. Used by the renderer to paint a still image of the page in
	 * place of the live `WebContentsView` for the duration of any HTML5
	 * drag gesture: native compositor views sit on top of every HTML
	 * pixel, so an ongoing drag would otherwise lose its drop overlays
	 * and ghost image the instant the cursor crossed the view's rect.
	 * The renderer caches the returned data URL and refreshes it
	 * proactively so the swap on `dragstart` is instantaneous.
	 *
	 * Resolves to `null` when the view doesn't exist or the capture
	 * fails (early in the view's lifetime before its first paint, or
	 * when the contents are being torn down). The renderer treats
	 * `null` as "no cache" and falls back to hiding the view without a
	 * placeholder image.
	 */
	async capturePage(tabId: string): Promise<string | null> {
		const state = this.views.get(tabId)
		if (!state) return null
		try {
			const image = await state.view.webContents.capturePage()
			if (image.isEmpty()) return null
			return image.toDataURL()
		} catch (err) {
			logger.warn('[MiniBrowserService] capturePage failed', { tabId, error: String(err) })
			return null
		}
	}

	/**
	 * Synchronous snapshot of the current URL / navigation state. The
	 * renderer uses this on mount to seed its toolbar UI before the
	 * first `did-navigate` event fires.
	 */
	getState(tabId: string): { url: string; canGoBack: boolean; canGoForward: boolean } | null {
		const state = this.views.get(tabId)
		if (!state) return null
		const nav = state.view.webContents.navigationHistory
		return {
			url: state.view.webContents.getURL(),
			canGoBack: nav.canGoBack(),
			canGoForward: nav.canGoForward()
		}
	}

	/**
	 * Wire the per-view events back to the renderer that owns this
	 * window. Each event carries the `tabId` so the renderer can
	 * dispatch to the correct `MiniBrowserPanel` instance.
	 */
	private wireEvents(tabId: string, state: MiniBrowserViewState): void {
		const { view, ownerWindow } = state
		const send = (channel: string, payload: Record<string, unknown>): void => {
			if (ownerWindow.isDestroyed() || ownerWindow.webContents.isDestroyed()) return
			ownerWindow.webContents.send(channel, payload)
		}
		// Never spawn an OS-level popup window from embedded content; a
		// `target=_blank` / `window.open` is denied outright (the
		// renderer can choose to open the URL in a new mini-browser tab
		// instead, via the navigate IPC).
		view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
		// Cancel any navigation to a non-http(s) scheme (file://,
		// javascript:, data:, …) — embedded pages stay on the web.
		view.webContents.on('will-navigate', (event, url) => {
			if (!isEmbeddableUrl(url)) {
				event.preventDefault()
				logger.warn('[MiniBrowserService] blocked non-embeddable will-navigate', { tabId, url })
			}
		})
		view.webContents.on('did-navigate', (_event, url) => {
			send('miniBrowser:did-navigate', { tabId, url })
		})
		view.webContents.on('did-navigate-in-page', (_event, url) => {
			send('miniBrowser:did-navigate-in-page', { tabId, url })
		})
		view.webContents.on('did-stop-loading', () => {
			const nav = view.webContents.navigationHistory
			send('miniBrowser:did-stop-loading', {
				tabId,
				canGoBack: nav.canGoBack(),
				canGoForward: nav.canGoForward()
			})
		})
		view.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
			if (isMainFrame) {
				logger.warn('[MiniBrowserService] mainFrame load failed', { tabId, errorCode, errorDescription, validatedURL })
			}
		})
		view.webContents.on('render-process-gone', (_e, details) => {
			logger.warn('[MiniBrowserService] render-process-gone', { tabId, reason: details.reason, exitCode: details.exitCode })
		})
		// Replaces the previous `console-message` bridge: when the
		// guest's window gains focus (user clicked inside), the
		// renderer panel re-fires a mousedown on its wrapper so the
		// workbench's activate-on-click listener picks it up.
		view.webContents.on('focus', () => {
			send('miniBrowser:user-interaction', { tabId })
		})
	}
}

export const miniBrowserService = new MiniBrowserService()
