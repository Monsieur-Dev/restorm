import React, { useMemo, useRef, useState } from 'react'
import { Button } from '../Button'
import { IconView } from '../IconView'
import { ScrollableElement } from '../ScrollableElement'
import { MarkdownViewer } from '../MarkdownViewer/MarkdownViewer'
import { ChatBubble } from '../ChatBubble'
import { Thumbnail, type ThumbnailMedia } from '../Thumbnail'
import { useMcpLogsFeed } from './useMcpLogsFeed'
import { Tooltip } from '../Tooltip'
import type { McpLogEntry, McpLogsLabels } from './types'
import './mcpLogs.css'

/** Resolves a tool's title i18n KEY (carried on each log entry) to display
 * text. The host wires this to its i18n `t()`. */
export type TranslateToolTitle = (titleKey: string) => string

/** Cap the payload view at this height; taller payloads scroll inside it. */
const PAYLOAD_MAX_HEIGHT = 240

/**
 * A request / response JSON payload, rendered inside the shared ECUI
 * `ChatBubble` (request = outgoing/right, response = incoming/left) so its
 * tint tracks the per-theme chat-bubble variables. The JSON itself is shown
 * via the ECUI `MarkdownViewer` (a ```json fenced block — syntax-highlighted,
 * far lighter than a Monaco editor per row), wrapped in an ECUI
 * `ScrollableElement` (capped at {@link PAYLOAD_MAX_HEIGHT}). Sizing
 * (response full-width-minus-gutter, request narrow) is owned by McpLogs CSS.
 */
const PayloadView: React.FC<{
  text: string
  side: 'request' | 'response'
  truncated: boolean
  truncatedLabel: string
  'data-testid': string
}> = ({ text, side, truncated, truncatedLabel, 'data-testid': dataTestId }) => {
  // Defense in depth: never render a payload block for an empty payload (the
  // caller already gates, but this guarantees no empty sliver bubble renders).
  if (isEmptyPayload(text)) return null
  // Render the JSON inside a fenced code block so the MarkdownViewer's
  // highlighter colours it as JSON.
  const markdown = '```json\n' + text + '\n```'
  return (
    <ChatBubble
      variant={side === 'request' ? 'outgoing' : 'incoming'}
      className={`ecui-mcp-logs-payload ecui-mcp-logs-${side}`}
      data-testid={dataTestId}
    >
      <ScrollableElement
        className="ecui-mcp-logs-payload-scroll"
        options={{ fitContent: true }}
        style={{ maxHeight: PAYLOAD_MAX_HEIGHT }}
      >
        <MarkdownViewer value={markdown} compact data-testid={`${dataTestId}-md`} />
      </ScrollableElement>
      {truncated && <span className="ecui-mcp-logs-truncated"> {truncatedLabel}</span>}
    </ChatBubble>
  )
}

export interface McpLogsPanelProps {
  /** Localized labels supplied by the host (ECUI ships no copy). */
  labels: McpLogsLabels
  /**
   * Resolves a tool's title i18n KEY (stamped on each entry at the tool's
   * registration) to display text — wire it to the host's `t()`. When omitted,
   * the row falls back to the raw tool name. ECUI carries no tool→title map;
   * the key travels on the entry, so the viewer needs zero tool knowledge.
   */
  translateToolTitle?: TranslateToolTitle
  'data-testid'?: string
}

/** Pretty-print a JSON payload string; fall back to the raw string. */
function formatPayload(payload: string, truncated: boolean): string {
  if (truncated) return payload
  if (payload === '') return ''
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}

function formatTime(ts: number): string {
  // Local ISO-ish `YYYY-MM-DD HH:MM:SS` — stable + sortable, no locale drift.
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/** Resolve a log capture to a renderable Thumbnail media, or null once it's no
 * longer retrievable. Both images and videos are served on demand from disk via
 * an `ecui-media://` URL in `path` (the renderer blocks `file://`, so the temp
 * file is streamed through the privileged scheme instead of bloating the buffer
 * with multi-MB base64). A capture is served on demand via its `path` (
 * `data:` URL fallback for any entry that predates on-demand image serving. */
function captureToMedia(capture: NonNullable<McpLogEntry['capture']>): ThumbnailMedia | null {
  if (capture.path) {
    return { kind: capture.kind, src: capture.path, mimeType: capture.mimeType }
  }
  return null
}

const McpLogCaptureView: React.FC<{ entry: McpLogEntry; labels: McpLogsLabels }> = ({ entry, labels }) => {
  const capture = entry.capture
  if (!capture) return null
  const caption = capture.kind === 'image' ? labels.screenshot : labels.screencast
  const titleText = capture.kind === 'image' ? labels.captureImageTitle : labels.captureVideoTitle
  const media = captureToMedia(capture)
  // The enlarged-view modal title: the same mcp glyph the rows use + a
  // localized caption (the host owns the copy; ECUI stays locale-free).
  const enlargedTitle = (
    <span className="ecui-mcp-logs-capture-title">
      <IconView icon={{ type: 'codicon', value: 'mcp' }} size={14} />
      {titleText}
    </span>
  )
  return (
    <div className="ecui-mcp-logs-capture" data-testid="mcp-logs-capture">
      <div className="ecui-mcp-logs-capture-caption">{caption}</div>
      {media ? (
        // Humans can't read a base64 blob — render the MEDIA itself, opening
        // large on click + copyable on right-click, via the ECUI Thumbnail.
        <Thumbnail
          media={media}
          title={enlargedTitle}
          labels={{ copy: labels.copy, close: labels.closePreview }}
          data-testid="mcp-logs-capture-thumbnail"
        />
      ) : (
        <div className="ecui-mcp-logs-capture-evicted">{labels.captureEvicted}</div>
      )}
    </div>
  )
}

/**
 * A request / response payload is "empty" (and therefore hidden) when it has
 * no meaningful content — blank, or an empty object / array. Keeps the chat
 * from showing useless `{}` bubbles for argument-less calls.
 */
function isEmptyPayload(formatted: string): boolean {
  const t = formatted.trim()
  return t === '' || t === '{}' || t === '[]'
}

const McpLogRow: React.FC<{
  entry: McpLogEntry
  labels: McpLogsLabels
  translateToolTitle: TranslateToolTitle
}> = ({ entry, labels, translateToolTitle }) => {
  const timeRef = useRef<HTMLSpanElement>(null)
  const [showTimeTooltip, setShowTimeTooltip] = useState(false)
  const request = useMemo(
    () => formatPayload(entry.payload, entry.payloadTruncated),
    [entry.payload, entry.payloadTruncated]
  )
  const response = useMemo(
    () => (entry.response === undefined ? '' : formatPayload(entry.response, entry.responseTruncated ?? false)),
    [entry.response, entry.responseTruncated]
  )
  const showRequest = !isEmptyPayload(request)
  // When the call produced a visual capture, its RESPONSE is the base64 / JSON
  // media blob — unreadable for a human. Suppress that text and let the
  // Thumbnail (rendered below by McpLogCaptureView) be the response instead.
  const showResponse = !isEmptyPayload(response) && entry.capture === undefined
  // Human-readable title (primary) + the raw tool name kept as a small
  // secondary so power users still see it. The title comes from the entry's
  // registered titleKey, resolved via the host i18n; if there's no key (or it
  // doesn't resolve) we fall back to the raw name and drop the now-redundant
  // secondary.
  const title = entry.titleKey !== undefined ? translateToolTitle(entry.titleKey) : entry.tool
  const showRawName = title !== entry.tool && title.length > 0
  return (
    <div className="ecui-mcp-logs-row" data-testid="mcp-logs-row">
      <div className="ecui-mcp-logs-row-head">
        <span className="ecui-mcp-logs-tool" data-testid="mcp-logs-tool">
          <IconView icon={{ type: 'codicon', value: 'mcp' }} size={13} />
          <span className="ecui-mcp-logs-tool-title">{title}</span>
          {showRawName && <span className="ecui-mcp-logs-tool-raw" data-testid="mcp-logs-tool-raw">{entry.tool}</span>}
        </span>
        <span
          ref={timeRef}
          className="ecui-mcp-logs-time"
          aria-label={labels.time}
          onMouseEnter={() => { setShowTimeTooltip(true) }}
          onMouseLeave={() => { setShowTimeTooltip(false) }}
        >{formatTime(entry.timestamp)}</span>
        <Tooltip
          targetRef={timeRef}
          content={labels.time}
          show={showTimeTooltip}
          placement="below"
        />
      </div>
      {(showRequest || showResponse) && (
        <div className="ecui-mcp-logs-chat">
          {showRequest && (
            <PayloadView
              text={request}
              side="request"
              truncated={entry.payloadTruncated}
              truncatedLabel={labels.truncated}
              data-testid="mcp-logs-request"
            />
          )}
          {showResponse && (
            <PayloadView
              text={response}
              side="response"
              truncated={entry.responseTruncated ?? false}
              truncatedLabel={labels.truncated}
              data-testid="mcp-logs-response"
            />
          )}
        </div>
      )}
      <McpLogCaptureView entry={entry} labels={labels} />
    </div>
  )
}

/**
 * Generic, host-agnostic viewer for the served-MCP-call buffer. Pulls its
 * entries from the source the host wired via `registerMcpLogsSource` and
 * renders each call's tool / timestamp / payload, with any captured
 * screenshot or screencast shown inline. All copy is injected via {@link
 * McpLogsLabels} so the component carries no baked-in strings (ECUI
 * isolation). Mount it as a workbench tab body or a modal body.
 */
export const McpLogsPanel: React.FC<McpLogsPanelProps> = ({ labels, translateToolTitle, 'data-testid': dataTestId }) => {
  const { entries, loading, canClear, clear } = useMcpLogsFeed()
  // Default: identity (a key resolves to itself) when the host wired no
  // translator — the row then falls back to the raw tool name anyway.
  const translate: TranslateToolTitle = translateToolTitle ?? ((k) => k)

  return (
    <div className="ecui-mcp-logs-panel" data-testid={dataTestId ?? 'mcp-logs-panel'}>
      <div className="ecui-mcp-logs-toolbar">
        <span className="ecui-mcp-logs-title">{labels.title}</span>
        {canClear && entries.length > 0 && (
          <Button
            icon="clear-all"
            onClick={() => { void clear() }}
            data-testid="mcp-logs-clear"
          >
            {labels.clear}
          </Button>
        )}
      </div>
      {entries.length === 0 && !loading ? (
        <div className="ecui-mcp-logs-empty" data-testid="mcp-logs-empty">{labels.empty}</div>
      ) : (
        <ScrollableElement className="ecui-mcp-logs-scroll" options={{ fitContent: true }} style={{ maxHeight: '100%' }}>
          <div className="ecui-mcp-logs-list">
            {entries.map((entry) => (
              // Key on stable identity (timestamp + tool + size), NOT the array
              // index — entries are prepended newest-first, so an index key
              // would shift on every new call and remount every row, resetting
              // per-row state (e.g. a Thumbnail's open enlarged view).
              <McpLogRow
                key={`${String(entry.timestamp)}-${entry.tool}-${String(entry.payloadBytes)}`}
                entry={entry}
                labels={labels}
                translateToolTitle={translate}
              />
            ))}
          </div>
        </ScrollableElement>
      )}
    </div>
  )
}
