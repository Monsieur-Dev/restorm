import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../Button'
import { ControlGroup } from '../ControlGroup'
import { InputBox } from '../InputBox'
import './miniBrowserPanel.css'

export interface MiniBrowserPanelProps {
  /** URL persisted on the host's tab. The webview loads this on
   * mount, and any user-driven navigation pushes the new URL back
   * through `onUrlChange` so the host's tab state stays in sync. */
  initialUrl?: string
  /** Persist the latest committed URL on the parent tab so reopening
   * the panel restores the same page. Called after a refresh, a
   * back navigation, or a manual address-bar submit — NOT on every
   * keystroke (typing in the address bar shouldn't churn the
   * persistence layer). */
  onUrlChange: (url: string) => void
}

/**
 * Electron webview tag — process-isolated guest browser, used by the
 * Mini browser instead of a plain `<iframe>`. Cross-site iframe storage
 * is partitioned by Chromium so a third-party SPA can't read its own
 * localStorage (e.g. login forms that persist a JWT silently fail). A
 * webview has its own top-level browsing context, so storage / cookies /
 * IndexedDB all work as if the user typed the URL in a real browser tab.
 *
 * React already ships `WebViewHTMLAttributes` / `HTMLWebViewElement`
 * intrinsics, so the `<webview>` element type-checks out of the box —
 * we only need a runtime-shape interface for the navigation methods
 * we call imperatively via the ref.
 */
interface WebviewNavigateEvent {
  url?: string
}
interface WebviewElement extends HTMLElement {
  src: string
  reload: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
}

/**
 * Tiny webview chrome — address bar, back, refresh, and an Electron
 * `<webview>` rendering whatever URL the user committed.
 */
export const MiniBrowserPanel: React.FC<MiniBrowserPanelProps> = ({ initialUrl, onUrlChange }) => {
  // Address bar text (what the user is typing) vs committed URL
  // (what the webview is actually loading). Decoupled so backspacing
  // through the address bar doesn't blank the webview.
  const [addressBar, setAddressBar] = useState(initialUrl ?? '')
  const [committedUrl, setCommittedUrl] = useState(initialUrl ?? '')

  // `<webview>` exposes its own navigation history (`goBack` / `canGoBack`),
  // so unlike a plain iframe we don't need a manual URL stack. Track only
  // the back-availability flag for the toolbar disabled state — it has to
  // live in React state because `canGoBack` isn't reactive.
  const webviewRef = useRef<WebviewElement | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)

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
    // Bare host or host:port → assume https (http for localhost).
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
  }, [])

  const handleSubmit = useCallback((): void => {
    commit(addressBar)
  }, [addressBar, commit])

  const handleRefresh = useCallback((): void => {
    webviewRef.current?.reload()
  }, [])

  const handleBack = useCallback((): void => {
    webviewRef.current?.goBack()
  }, [])

  // Mirror webview navigation back into address bar + committed URL +
  // the parent tab. `did-navigate` fires for top-level navigations
  // (link clicks, form submits, location.href = ...). `did-navigate-in-page`
  // covers SPA route changes (history.pushState / replaceState) so the
  // address bar stays accurate inside single-page apps.
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    const refreshBackState = (): void => { setCanGoBack(webview.canGoBack()) }
    const handleNavigate = (raw: Event): void => {
      const e = raw as unknown as WebviewNavigateEvent
      if (typeof e.url === 'string' && e.url !== '') {
        setAddressBar(e.url)
        setCommittedUrl(e.url)
      }
      refreshBackState()
    }
    const handleStopLoading = (): void => { refreshBackState() }
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    return () => {
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
    }
  }, [])

  const canRefresh = committedUrl !== ''

  return (
    <div className="mini-browser-panel" data-testid="mini-browser-panel">
      {/* Toolbar uses ECUI primitives (`Button` + `InputBox`) wrapped in
       * `ControlGroup` so back / refresh / address / go render as a
       * single joined strip (shared borders, no gaps) — the visual
       * idiom the rest of the app uses for address-bar-shaped toolbars.
       * The hand-rolled `<button>` / `<input>` it replaced rendered with
       * default UA colors, which clashed with the workbench theme. */}
      <div className="mini-browser-panel__toolbar">
        <ControlGroup className="mini-browser-panel__controls">
          <Button
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
            emphasis={1}
            icon="arrow-right"
            onClick={handleSubmit}
            options={{ ariaLabel: 'Go', title: 'Go' }}
            data-testid="mini-browser-button-go"
          />
        </ControlGroup>
      </div>
      <div className="mini-browser-panel__frame">
        {committedUrl === '' ? (
          <div className="mini-browser-panel__placeholder" data-testid="mini-browser-placeholder">
            Enter an address above to start browsing.
          </div>
        ) : (
          // No `allowpopups` — Mini browser intentionally swallows
          // window.open calls (we'd have no chrome to host them). Users
          // who want a new tab can paste the URL into the address bar.
          <webview
            ref={webviewRef as unknown as React.RefObject<HTMLWebViewElement>}
            className="mini-browser-panel__iframe"
            src={committedUrl}
            data-testid="mini-browser-iframe"
          />
        )}
      </div>
    </div>
  )
}
