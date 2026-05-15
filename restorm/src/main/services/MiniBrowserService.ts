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

interface MiniBrowserViewState {
	view: WebContentsView
	ownerWindow: BrowserWindow
	lastBounds: { x: number; y: number; width: number; height: number } | null
	isAttached: boolean
}

export interface MiniBrowserBounds {
	x: number
	y: number
	width: number
	height: number
}

class MiniBrowserService {
	private views = new Map<string, MiniBrowserViewState>()

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
			if (initialUrl && existing.view.webContents.getURL() === '' && initialUrl !== '') {
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
		ownerWindow.contentView.addChildView(view)
		const state: MiniBrowserViewState = {
			view,
			ownerWindow,
			lastBounds: null,
			isAttached: true
		}
		this.views.set(tabId, state)
		this.wireEvents(tabId, state)
		if (initialUrl) {
			void view.webContents.loadURL(initialUrl).catch((err: unknown) => {
				logger.warn('[MiniBrowserService] initial loadURL failed', { tabId, url: initialUrl, error: String(err) })
			})
		}
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
		const rounded = {
			x: Math.round(bounds.x),
			y: Math.round(bounds.y),
			width: Math.max(0, Math.round(bounds.width)),
			height: Math.max(0, Math.round(bounds.height))
		}
		const prev = state.lastBounds
		if (prev?.x === rounded.x && prev.y === rounded.y && prev.width === rounded.width && prev.height === rounded.height) {
			return
		}
		state.view.setBounds(rounded)
		state.lastBounds = rounded
	}

	navigate(tabId: string, url: string): void {
		const state = this.views.get(tabId)
		if (!state) return
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
