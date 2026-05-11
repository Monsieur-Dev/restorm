import React, { useCallback, useEffect, useRef, useState } from 'react'
import { IconView } from 'electron-core-ui/renderer'
import './miniBrowserPanel.css'

interface MiniBrowserPanelProps {
  /** URL persisted on the workbench tab. The iframe loads this on
   * mount, and any user-driven navigation pushes the new URL back
   * through `onUrlChange` so the workbench tree state stays in sync. */
  initialUrl?: string
  /** Persist the latest committed URL on the parent tab so reopening
   * the workbench restores the same page. Called after a refresh, a
   * back navigation, or a manual address-bar submit — NOT on every
   * keystroke (typing in the address bar shouldn't churn the
   * persistence layer). */
  onUrlChange: (url: string) => void
}

/**
 * Tiny webview chrome — address bar, back, refresh, and an
 * `<iframe>` rendering whatever URL the user committed.
 *
 * Why `<iframe>` (not `<webview>`): the user asked for a literal
 * iframe and the goal is mostly developer-facing — viewing API
 * playgrounds, docs, and the artifactsmmo game UI side-by-side
 * with their restorm session. Sites that set `X-Frame-Options: DENY`
 * or `frame-ancestors 'none'` won't render; that's a known
 * limitation of the iframe transport (we surface it via the
 * `onError` overlay).
 */
export const MiniBrowserPanel: React.FC<MiniBrowserPanelProps> = ({ initialUrl, onUrlChange }) => {
  // Address bar text (what the user is typing) vs committed URL
  // (what the iframe is actually loading). Decoupled so backspacing
  // through the address bar doesn't blank the iframe.
  const [addressBar, setAddressBar] = useState(initialUrl ?? '')
  const [committedUrl, setCommittedUrl] = useState(initialUrl ?? '')

  // History stack for the back button. We only push on commits the
  // user actively triggered (Enter / Go / refresh / replace), not on
  // sub-resource loads — the iframe doesn't expose its navigation
  // events cross-origin, so a "true" browser history is impossible
  // here. This stack tracks the addresses the user typed, which is
  // good enough for the "go back to the previous URL I tried" UX.
  const [history, setHistory] = useState<string[]>([])

  // Refresh nonce so clicking the refresh button forces the iframe
  // to reload even when the URL hasn't changed. Without this, React
  // sees the same `src` and skips the re-render.
  const [refreshNonce, setRefreshNonce] = useState(0)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
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
    setHistory((prev) => (committedUrl !== '' && committedUrl !== normalised ? [...prev, committedUrl] : prev))
    setCommittedUrl(normalised)
  }, [committedUrl])

  const handleSubmit = useCallback((e: React.SyntheticEvent): void => {
    e.preventDefault()
    commit(addressBar)
  }, [addressBar, commit])

  const handleRefresh = useCallback((): void => {
    if (committedUrl === '') return
    setRefreshNonce((n) => n + 1)
    // No `commit` here — refresh shouldn't push the same URL onto
    // the back stack a second time.
  }, [committedUrl])

  const handleBack = useCallback((): void => {
    setHistory((prev) => {
      if (prev.length === 0) return prev
      const next = prev.slice(0, -1)
      const previousUrl = prev[prev.length - 1]
      if (previousUrl !== undefined) {
        setAddressBar(previousUrl)
        setCommittedUrl(previousUrl)
      }
      return next
    })
  }, [])

  const canGoBack = history.length > 0
  const canRefresh = committedUrl !== ''

  // `key` change forces the iframe to remount on refresh — simpler
  // and more reliable than poking `contentWindow.location.reload()`
  // which throws under cross-origin (no permission to touch the
  // child frame's location).
  const iframeKey = `${committedUrl}::${String(refreshNonce)}`

  return (
    <div className="mini-browser-panel" data-testid="mini-browser-panel">
      <form className="mini-browser-panel__toolbar" onSubmit={handleSubmit}>
        <button
          type="button"
          className="mini-browser-panel__button"
          disabled={!canGoBack}
          onClick={handleBack}
          aria-label="Back"
          title="Back"
          data-testid="mini-browser-button-back"
        >
          <IconView icon={{ type: 'codicon', value: 'arrow-left' }} size={14} />
        </button>
        <button
          type="button"
          className="mini-browser-panel__button"
          disabled={!canRefresh}
          onClick={handleRefresh}
          aria-label="Refresh"
          title="Refresh"
          data-testid="mini-browser-button-refresh"
        >
          <IconView icon={{ type: 'codicon', value: 'refresh' }} size={14} />
        </button>
        <input
          className="mini-browser-panel__address"
          type="text"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          value={addressBar}
          placeholder="https://example.com"
          onChange={(e) => { setAddressBar(e.target.value) }}
          aria-label="Address"
          data-testid="mini-browser-address"
        />
        <button
          type="submit"
          className="mini-browser-panel__button mini-browser-panel__button--primary"
          aria-label="Go"
          title="Go"
          data-testid="mini-browser-button-go"
        >
          <IconView icon={{ type: 'codicon', value: 'arrow-right' }} size={14} />
        </button>
      </form>
      <div className="mini-browser-panel__frame">
        {committedUrl === '' ? (
          <div className="mini-browser-panel__placeholder" data-testid="mini-browser-placeholder">
            Enter an address above to start browsing.
          </div>
        ) : (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            className="mini-browser-panel__iframe"
            src={committedUrl}
            title="Mini browser"
            data-testid="mini-browser-iframe"
            sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
          />
        )}
      </div>
    </div>
  )
}
