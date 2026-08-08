/**
 * Renderer-side shape of one served-MCP-call entry, mirroring the main
 * process {@link McpServedCallEntry} the host streams across IPC. Kept as a
 * standalone renderer type so the viewer never imports from the main bundle.
 */
export interface McpLogEntry {
  /** Epoch milliseconds when the call was received. */
  timestamp: number
  /** The MCP tool name. */
  tool: string
  /** The call arguments, JSON-stringified (already truncated past the cap). */
  payload: string
  /** True when {@link payload} was elided because it exceeded the cap. */
  payloadTruncated: boolean
  /** Original payload byte length before truncation. */
  payloadBytes: number
  /** The tool's result, JSON-stringified + truncated past the cap. Absent until
   * the call completes (captured when the local handler resolves). */
  response?: string
  /** True when {@link response} was elided because it exceeded the cap. */
  responseTruncated?: boolean
  /** A visual artefact this call produced, when it was a capture tool. */
  capture?: McpLogCapture
  /** i18n KEY for the tool's human-readable title, stamped at the tool's
   * registration (so there's no name→title map to drift). The viewer resolves
   * it via the host's `translateToolTitle`; falls back to the raw tool name
   * when absent / unresolved. */
  titleKey?: string
}

/** A captured artefact (screenshot / screencast) attached to a log entry. */
export interface McpLogCapture {
  /** `image` for a PNG screenshot, `video` for a screencast clip. */
  kind: 'image' | 'video'
  /** MIME type, e.g. `image/png` or `video/webm`. */
  mimeType: string
  /** An `ecui-media://<ns>/<file>` URL the renderer loads on demand (the renderer
   * blocks `file://`, so the temp file is streamed via the privileged scheme
   * rather than inlined): `screenshot/<file>.png` for an image, `screencast/<file>`
   * for a video. Kept even on older entries since it's lightweight; the capture
   * stays loadable while its temp file exists. */
  path?: string
}

/**
 * Injected data source the viewer pulls from. The host wires this once at
 * renderer bootstrap to whatever IPC carries the served-call buffer — so the
 * generic ECUI component never references a concrete channel name.
 */
export interface McpLogsSource {
  /** Fetch the current buffer (newest-first). */
  getLogs(): Promise<McpLogEntry[]>
  /** Subscribe to buffer changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void
  /** Clear the buffer (optional — omit to hide the clear action). */
  clear?(): Promise<void> | void
}

/**
 * Localized labels the host passes in so the generic viewer carries no
 * baked-in copy. Every field is required — the host resolves them from its
 * i18n catalogue.
 */
export interface McpLogsLabels {
  /** Panel heading / empty-state title. */
  title: string
  /** Shown when the buffer is empty. */
  empty: string
  /** "Clear" button label. */
  clear: string
  /** Column / field label for the tool name. */
  tool: string
  /** Column / field label for the timestamp. */
  time: string
  /** Column / field label for the payload. */
  payload: string
  /** Suffix shown when a payload was truncated, e.g. "(truncated)". */
  truncated: string
  /** Caption for an inline screenshot capture. */
  screenshot: string
  /** Caption for an inline screencast capture. */
  screencast: string
  /** Shown when a capture's payload was evicted from memory. */
  captureEvicted: string
  /** Right-click "Copy" entry on a media thumbnail (copies it to clipboard). */
  copy: string
  /** Accessible label for the close control of an enlarged media preview. */
  closePreview: string
  /** Title for the enlarged image-capture modal, e.g. "MCP screenshot". */
  captureImageTitle: string
  /** Title for the enlarged video-capture modal, e.g. "MCP recording". */
  captureVideoTitle: string
}
