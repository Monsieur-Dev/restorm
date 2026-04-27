/**
 * Smart-paste integration for HTTP-style request tab views.
 *
 * The hook intercepts `paste` events on the wired DOM subtree, sniffs
 * for a `curl` command, parses it via the shared `parseCurlCommand`
 * helper, and exposes a `pendingPaste` state the host renders into a
 * non-modal "Replace request? / Cancel" callout. Every detected cURL
 * paste asks for confirmation — there's no "first time only" shortcut.
 * The earlier opt-in-on-first-use mode would silently swallow
 * subsequent pastes, which surprised users; the explicit prompt is
 * cheap (one click) and unambiguous.
 *
 * The hook is shape-agnostic: each request-tab view passes a small
 * `apply` callback that maps the parsed cURL onto its own state setters
 * (HTTP populates URL/method/headers/params/body, GraphQL only fills
 * URL/headers, etc.). The hook does not assume HTTP semantics.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { isCurlText, parseCurlCommand } from '../../../shared/utils/parseCurlCommand'

/** Output of `parseCurlCommand` — re-exported here so callers don't
 * have to reach into `shared/utils` to type their `apply` callback. */
export type ParsedCurl = NonNullable<ReturnType<typeof parseCurlCommand>>

export interface UseCurlPasteOptions {
  /**
   * Element the paste listener attaches to. Pasting anywhere inside
   * this subtree (URL field, headers table, body editor) triggers
   * detection; pastes outside it bubble up unchanged.
   */
  readonly hostRef: RefObject<HTMLElement | null>
  /**
   * Called when the user confirms with the parsed cURL. Implementers
   * map onto their own state setters — the hook never writes to
   * anything itself.
   */
  readonly apply: (parsed: ParsedCurl) => void
  /**
   * Soft cap on the clipboard size we'll inspect. Anything above this
   * is treated as a non-cURL paste and falls through to the default
   * paste handler — keeps the UI responsive on huge clipboards. */
  readonly maxClipboardSize?: number
}

export interface PendingCurlPaste {
  readonly parsed: ParsedCurl
  readonly confirm: () => void
  readonly cancel: () => void
}

export interface UseCurlPasteResult {
  /** Non-null while the host should render the "Replace?" callout. */
  readonly pendingPaste: PendingCurlPaste | null
}

const DEFAULT_MAX_CLIPBOARD_SIZE = 100_000

export function useCurlPaste(options: UseCurlPasteOptions): UseCurlPasteResult {
  const { hostRef, apply, maxClipboardSize = DEFAULT_MAX_CLIPBOARD_SIZE } = options
  const [pending, setPending] = useState<PendingCurlPaste | null>(null)
  // Ref-mirror the latest `apply` callback so the listener captures a
  // stable reference — avoids re-attaching on every parent render.
  const applyRef = useRef(apply)
  useEffect(() => { applyRef.current = apply }, [apply])

  const handlePaste = useCallback((event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData('text') ?? ''
    if (text.length === 0 || text.length > maxClipboardSize) return
    if (!isCurlText(text)) return
    const parsed = parseCurlCommand(text)
    if (!parsed) return

    // Stop the default paste so the URL field / Monaco editor doesn't
    // also receive the raw curl command as its value.
    event.preventDefault()
    event.stopPropagation()

    setPending({
      parsed,
      confirm: () => {
        applyRef.current(parsed)
        setPending(null)
      },
      cancel: () => {
        setPending(null)
      }
    })
  }, [maxClipboardSize])

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    // Capture phase so we win against Monaco's own paste handler when
    // the user pastes into the URL field. Monaco swallows `paste` on
    // its hidden textarea, so attaching to a wrapper above the editor
    // is the only way to see the event in time to call `preventDefault`.
    node.addEventListener('paste', handlePaste, true)
    return () => { node.removeEventListener('paste', handlePaste, true) }
  }, [hostRef, handlePaste])

  return { pendingPaste: pending }
}
