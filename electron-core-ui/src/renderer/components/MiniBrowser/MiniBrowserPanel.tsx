import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../Button'
import { ControlGroup } from '../ControlGroup'
import { InputBox } from '../InputBox'
import './miniBrowserPanel.css'

/**
 * Host-provided driver that talks to whatever Electron-side service
 * owns the embedded web content. `MiniBrowserPanel` only renders the
 * toolbar + an empty placeholder slot; the actual web content lives
 * outside this component's React subtree (in restorm: a
 * `WebContentsView` in the main process) and is positioned by the
 * host on `setBounds(tabId, rect)` calls driven by this panel's
 * `ResizeObserver`.
 *
 * Generic by design: ECUI doesn't know about restorm's IPC bridge, so
 * the host (restorm) implements this interface against
 * `window.restorm.miniBrowser.*` and passes the adapter in. A
 * different consumer could implement it against a fully renderer-side
 * `<webview>` if that fit their constraints — at the cost of losing
 * the "no reload on DOM re-parenting" guarantee that the
 * main-process content view buys.
 */
export interface MiniBrowserDriver {
  /** Create the content view bound to this tab id (idempotent). */
  create: (tabId: string, initialUrl?: string) => Promise<unknown>
  /** Tear down the content view on the panel's final unmount. */
  destroy: (tabId: string) => Promise<unknown>
  /** Position the content view in window-coordinate space (DIP).
   * Zero-size bounds should hide the view rather than render an
   * empty rect over the workbench. */
  setBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<unknown>
  navigate: (tabId: string, url: string) => Promise<unknown>
  reload: (tabId: string) => Promise<unknown>
  goBack: (tabId: string) => Promise<unknown>
  goForward: (tabId: string) => Promise<unknown>
  /** Synchronous snapshot, used to seed the toolbar on mount before
   * the first `did-navigate` event arrives. Returns `null` when the
   * driver hasn't seen this tabId yet. */
  getState: (tabId: string) => Promise<{ url: string; canGoBack: boolean; canGoForward: boolean } | null>
  onDidNavigate: (callback: (result: { tabId: string; url: string }) => void) => () => void
  onDidStopLoading: (callback: (result: { tabId: string; canGoBack: boolean; canGoForward: boolean }) => void) => () => void
  /** Fires when the embedded page receives a user interaction (click /
   * focus). The panel re-dispatches a synthetic `mousedown` on its
   * wrapper so the host workbench's activate-on-click listener
   * focuses the owning group — same UX as clicking inside a regular
   * tab's body. */
  onUserInteraction: (callback: (result: { tabId: string }) => void) => () => void
}

export interface MiniBrowserPanelProps {
  /** Stable id used by the host driver to keep its content view
   * matched to this React panel. Required: cross-group moves and
   * persistence both key off this id, and the driver assumes a 1:1
   * relationship between `tabId` and content view. */
  tabId: string
  /** URL persisted on the host's tab. Seeds the address bar and is
   * passed to `driver.create` so the host can navigate the content
   * view on first attach. */
  initialUrl?: string
  /** Persist the latest committed URL on the parent tab so reopening
   * the panel restores the same page. Called after navigation,
   * refresh, or a manual address-bar submit. */
  onUrlChange: (url: string) => void
  /** Host-provided lifecycle bridge — see `MiniBrowserDriver`. */
  driver: MiniBrowserDriver
}

/**
 * Toolbar-only Mini browser: address bar, back / refresh / go, and a
 * placeholder slot whose layout rect the host's `MiniBrowserDriver`
 * uses to position an out-of-React-tree content view (in restorm: a
 * main-process `WebContentsView`). The embedded page is NOT a child
 * of this component — that's deliberate: putting the page inside the
 * React tree (as a `<webview>` tag) meant Chromium tore down the
 * guest process on every cross-group tab move, since `appendChild`
 * re-parenting counts as a disconnect-then-connect for the
 * `<webview>` element specifically. Lifting the content out keeps the
 * panel free to be moved / re-rendered / re-portalled by the
 * workbench without disturbing the embedded page.
 */
export const MiniBrowserPanel: React.FC<MiniBrowserPanelProps> = ({ tabId, initialUrl, onUrlChange, driver }) => {
  const [addressBar, setAddressBar] = useState(initialUrl ?? '')
  const [committedUrl, setCommittedUrl] = useState(initialUrl ?? '')
  const [canGoBack, setCanGoBack] = useState(false)
  // `canGoForward` is tracked for parity with the navigation history
  // exposed by the driver — even though the current toolbar UI
  // doesn't render a forward button, a future "browser-shaped"
  // variant will, and centralising the state here means we don't
  // need a second pass through this component to add it.
  const [, setCanGoForward] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const slotRef = useRef<HTMLDivElement | null>(null)
  const lastPersistedRef = useRef<string>(initialUrl ?? '')

  // Sync committed URL back into the parent tab — but only when it
  // actually differs from the last value we persisted. Initial mount
  // would otherwise re-broadcast the URL the parent just handed us.
  useEffect(() => {
    if (committedUrl !== lastPersistedRef.current) {
      lastPersistedRef.current = committedUrl
      onUrlChange(committedUrl)
    }
  }, [committedUrl, onUrlChange])

  /** Normalise an address-bar entry. Treats `localhost:3000` and
   * `example.com/foo` as `http://localhost:3000` / `https://example.com/foo`
   * so users don't have to type the scheme. Anything with an explicit
   * scheme is passed through verbatim. */
  const normaliseUrl = (raw: string): string => {
    const trimmed = raw.trim()
    if (trimmed === '') return ''
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('localhost') || lower.startsWith('127.0.0.1') || lower.startsWith('0.0.0.0')) {
      return `http://${trimmed}`
    }
    return `https://${trimmed}`
  }

  const commit = useCallback((url: string): void => {
    const normalised = normaliseUrl(url)
    if (normalised === '') return
    setAddressBar(normalised)
    setCommittedUrl(normalised)
    void driver.navigate(tabId, normalised)
  }, [driver, tabId])

  const handleSubmit = useCallback((): void => {
    commit(addressBar)
  }, [addressBar, commit])

  const handleRefresh = useCallback((): void => {
    void driver.reload(tabId)
  }, [driver, tabId])

  const handleBack = useCallback((): void => {
    void driver.goBack(tabId)
  }, [driver, tabId])

  // `initialUrl` is captured once at mount via a ref so the create-effect
  // doesn't depend on it. A late prop change to `initialUrl` would
  // otherwise tear the view down and recreate it — losing in-page
  // state, which defeats the whole point of this architecture. The
  // driver's `create` seeds the URL only when the view is freshly
  // born; subsequent navigation goes through `driver.navigate`.
  const initialUrlRef = useRef(initialUrl)

  // Mount the content view on first render, tear it down on the panel's
  // final unmount. The `tabId` is stable per panel instance: a
  // workbench cross-group move keeps the same React subtree (and so
  // the same `tabId`), so the driver sees a single `create` + many
  // `setBounds` updates.
  //
  // `useLayoutEffect` (NOT `useEffect`) so the IPC `create` call is
  // dispatched BEFORE the `setBounds` call from the layout effect
  // below — both ride the same `ipcRenderer.invoke` queue, so the
  // main-side service sees `create` first and the immediately
  // following `setBounds` finds the view ready to position. With
  // `useEffect` ordering, `setBounds` would arrive on an unknown
  // tabId and be silently dropped, leaving the view at its initial
  // `setVisible(false)` state.
  useLayoutEffect(() => {
    void driver.create(tabId, initialUrlRef.current)
    return () => {
      void driver.destroy(tabId)
    }
  }, [driver, tabId])

  // Seed the toolbar from the driver's snapshot — covers the case
  // where the panel re-mounts after a focus loss while the view still
  // holds an in-progress navigation state.
  useEffect(() => {
    let cancelled = false
    void driver.getState(tabId).then((state) => {
      if (cancelled || !state) return
      if (state.url !== '') {
        setAddressBar(state.url)
        setCommittedUrl(state.url)
      }
      setCanGoBack(state.canGoBack)
      setCanGoForward(state.canGoForward)
    })
    return () => { cancelled = true }
  }, [driver, tabId])

  // Subscribe to navigation events. `did-navigate-in-page` covers SPA
  // route changes (history.pushState / replaceState) so the address
  // bar stays accurate inside single-page apps.
  useEffect(() => {
    const unsubNav = driver.onDidNavigate((result) => {
      if (result.tabId !== tabId) return
      if (result.url !== '') {
        setAddressBar(result.url)
        setCommittedUrl(result.url)
      }
    })
    const unsubStop = driver.onDidStopLoading((result) => {
      if (result.tabId !== tabId) return
      setCanGoBack(result.canGoBack)
      setCanGoForward(result.canGoForward)
    })
    return () => {
      unsubNav()
      unsubStop()
    }
  }, [driver, tabId])

  // Bridge guest-page interactions to the host workbench: when the
  // user clicks inside the embedded page, the host content view fires
  // a `focus` event. We re-dispatch a synthetic `mousedown` on the
  // wrapper so the workbench's native activate-on-click listener
  // (attached on the group's placeholder, a DOM ancestor of the
  // wrapper) picks it up.
  useEffect(() => {
    const unsub = driver.onUserInteraction((result) => {
      if (result.tabId !== tabId) return
      wrapperRef.current?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })
    return unsub
  }, [driver, tabId])

  // Track the slot's layout rect and push it to the driver. The slot
  // is the empty `<div>` below the toolbar; its `getBoundingClientRect`
  // is in viewport (DIP) coords which the main-process service
  // converts to the BrowserWindow's content coord space.
  //
  // `useLayoutEffect` (NOT `useEffect`) so the first `setBounds` fires
  // synchronously with layout, before the next paint — otherwise the
  // user would see one frame with the toolbar laid out but the
  // content view still at its (0,0,0,0) initial bounds.
  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el) return undefined
    let raf: number | null = null
    // Track the last rect we actually pushed so the polling fallback
    // skips unchanged frames (cheap `===` compare on 4 numbers).
    let last: { x: number; y: number; width: number; height: number } | null = null
    const push = (): void => {
      raf = null
      const rect = el.getBoundingClientRect()
      const next = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      if (last?.x === next.x && last.y === next.y && last.width === next.width && last.height === next.height) {
        return
      }
      last = next
      void driver.setBounds(tabId, next)
    }
    // Initial push synchronously so the content view shows up in the
    // right place on first frame. Subsequent updates are coalesced
    // through `requestAnimationFrame` — both `ResizeObserver` and the
    // window's resize event can fire many times per frame during a
    // sash drag.
    push()
    const schedule = (): void => {
      if (raf !== null) return
      raf = requestAnimationFrame(push)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    const onWindowResize = (): void => { schedule() }
    window.addEventListener('resize', onWindowResize)
    // Catch position-only changes — the slot may keep its size when
    // the workbench reparents it into a different group (e.g. moving
    // the tab to a different row via Ctrl+Alt+↓). `ResizeObserver`
    // ignores those; without a separate signal the embedded content
    // would freeze at the old screen position until the next genuine
    // size change. A `MutationObserver` over the whole document
    // watches every DOM mutation (childList, subtree, attributes,
    // class changes) which covers React's commits + CSS-driven
    // layouts and reliably picks up the reparent. `push()` itself
    // diffs against the last pushed rect so unchanged mutations are
    // cheap.
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
    // Safety net for layout signals that neither the ResizeObserver nor
    // the MutationObserver picks up reliably. Concretely: a cross-row
    // tab move can change the slot's screen position without changing
    // its size (ResizeObserver miss) and without leaving any DOM
    // mutation footprint that document.body's subtree sees in the same
    // frame — React commits the structural reparent in a way that
    // observers fire before layout settles, so a getBoundingClientRect
    // read inside the observer callback returns the pre-move rect. A
    // cheap rect poll fills the gap. The diff check inside `push()`
    // skips IPC when the rect is unchanged, so the steady-state cost is
    // 4 number comparisons every 100 ms — negligible for a Mini browser
    // that's typically open in 1–2 tabs at most.
    const poll = setInterval(push, 100)
    return () => {
      ro.disconnect()
      mo.disconnect()
      clearInterval(poll)
      window.removeEventListener('resize', onWindowResize)
      if (raf !== null) cancelAnimationFrame(raf)
      // No `setBounds(0,0,0,0)` on cleanup: the slot's
      // `ResizeObserver` already fires with a zero-size rect when the
      // panel is hidden via `display:none` (tab switch), which
      // collapses + hides the view through the normal `push` path.
      // On real unmount the create-effect's cleanup tears the view
      // down entirely — calling `setBounds` afterwards would land on a
      // destroyed view (warn-logged as "unknown tabId") which is
      // harmless but noisy. Under React StrictMode the cleanup order
      // and React 19's behaviour mean a "(0,0,0,0) before destroy"
      // assumption isn't reliable across effects, so we skip it.
    }
  }, [driver, tabId])

  const canRefresh = committedUrl !== ''

  return (
    <div ref={wrapperRef} className="mini-browser-panel" data-testid="mini-browser-panel">
      {/* Toolbar uses ECUI primitives wrapped in `ControlGroup` so back
       * / refresh / address / go render as a single joined strip. */}
      <div className="mini-browser-panel__toolbar">
        <ControlGroup className="mini-browser-panel__controls">
          <Button
            small
            icon="arrow-left"
            disabled={!canGoBack}
            onClick={handleBack}
            options={{ ariaLabel: 'Back', title: 'Back' }}
            data-testid="mini-browser-button-back"
          />
          <Button
            icon="refresh"
            disabled={!canRefresh}
            onClick={handleRefresh}
            options={{ ariaLabel: 'Refresh', title: 'Refresh' }}
            data-testid="mini-browser-button-refresh"
          />
          <InputBox
            className="mini-browser-panel__address"
            value={addressBar}
            onChange={(v) => { setAddressBar(v) }}
            // Address bar feels broken with the default 200ms debounce
            // — a fast type-then-Enter would commit a stale value.
            changeDebounceMs={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSubmit()
              }
            }}
            options={{
              placeholder: 'https://example.com',
              ariaLabel: 'Address'
            }}
            data-testid="mini-browser-address"
          />
          <Button
            small
            emphasis={1}
            icon="arrow-right"
            onClick={handleSubmit}
            options={{ ariaLabel: 'Go', title: 'Go' }}
            data-testid="mini-browser-button-go"
          />
        </ControlGroup>
      </div>
      <div className="mini-browser-panel__frame">
        {/* Placeholder slot — the host's content view is positioned over
         * this rect via `setBounds`. No `<webview>` here: the embedded
         * page lives in the main process (or wherever the host driver
         * routes it) so cross-group DOM moves don't tear down the
         * guest. The slot also doubles as the un-loaded-state hint
         * area when the address bar is empty. */}
        <div
          ref={slotRef}
          className="mini-browser-panel__slot"
          data-testid="mini-browser-slot"
          {...(committedUrl === '' ? { 'data-empty': 'true' } : {})}
        >
          {committedUrl === '' ? (
            <div className="mini-browser-panel__placeholder" data-testid="mini-browser-placeholder">
              Enter an address above to start browsing.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
