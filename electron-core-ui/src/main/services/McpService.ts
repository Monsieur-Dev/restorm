import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin, basename as pathBasename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { app, BrowserWindow, ipcMain, dialog as electronDialog, protocol, net } from 'electron'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { logger } from './LoggerService'
import { MCP_SESSION_ROUTING_KEY, MCP_FORWARDED_HEADER, forwardToNamedSession } from './mcpDiscovery'
import {
  MINI_BROWSER_OPEN_CHANNEL,
  MINI_BROWSER_EXECUTE_CHANNEL,
  MINI_BROWSER_EXECUTE_REPLY_CHANNEL,
  CONSOLE_OPEN_CHANNEL,
  CONSOLE_CLEAR_CHANNEL,
  SET_TAB_MAXIMIZED_CHANNEL
} from '../../types/ipcChannels'

// Re-exported for consumers that reference the bridge contract via the
// McpService surface; the definitions live in ./mcpDiscovery (shared with the
// transport so there's no import cycle).
export { MCP_SESSION_ROUTING_KEY, MCP_FORWARDED_HEADER } from './mcpDiscovery'

/** Default cap on the served-MCP-call ring buffer (overridable at runtime). */
export const DEFAULT_SERVED_CALL_CAP = 100

/**
 * Max byte length of a served call's stringified arguments kept verbatim;
 * anything longer is elided with a `…(truncated)` marker so a large request
 * body can't grow the buffer without bound.
 */
const MCP_SERVED_PAYLOAD_MAX = 8_192

/**
 * Default for how many of the most-recent served-call entries keep their heavy
 * capture payload (image base64 / video temp file). Older entries drop the
 * payload (+ delete the temp file) but keep the capture metadata, bounding
 * memory + disk for the screenshot/screencast bonus. Overridable at runtime via
 * {@link McpService.setCaptureRetentionCap} (a user setting). Heavier than the
 * log-text cap since each capture is a file/blob, but far smaller than the
 * call-count cap.
 */
export const DEFAULT_CAPTURE_RETENTION_CAP = 20

export interface McpServiceOptions {
  /**
   * Display name + version sent to MCP clients during the
   * `initialize` handshake. Defaults to a generic ECUI identity.
   */
  serverInfo?: { name: string; version: string }

  /**
   * Optional onboarding text forwarded to MCP clients in the
   * `initialize` response (`instructions`). A new client (often an AI
   * agent) reads this first to orient itself — what the server is for,
   * the core workflows, the key tool groups, conventions. Keep it a
   * concise but self-sufficient "read me first" so a fresh client can
   * use the server out-of-the-box without trial-and-error.
   */
  instructions?: string

  /**
   * Optional bearer token. When set to a non-empty string, every
   * incoming HTTP request must carry `Authorization: Bearer <token>`;
   * mismatched / missing headers get a `401 Unauthorized`. When omitted
   * — or set to the empty string — no auth is enforced, which keeps
   * existing callers (tests, ECUI consumers without auth needs) working.
   * The empty-string short-circuit is deliberate: it lets a caller pass
   * a runtime-resolved token without having to rebuild the options
   * object when MCP runs in "no auth" mode.
   *
   * The token is opaque to the service: caller picks the entropy + the
   * propagation channel (e.g. restorm writes it into its discovery file
   * so the MCP launcher reads it back transparently).
   */
  authToken?: string

  /**
   * Optional human-readable name identifying THIS MCP instance. When set,
   * the raw-request layer reads an optional reserved `__session` routing
   * key off a `tools/call`'s `arguments`: if it's absent or equals this
   * name, the key is stripped and the call runs locally (unchanged); if
   * it names a DIFFERENT instance, the call is forwarded to the peer that
   * owns that name (discovered in {@link discoveryDir}). The match is
   * verbatim (the consumer chooses the identity — a full ticket name with
   * spaces is fine).
   *
   * Omitted → no routing layer at all (every call runs locally, and a
   * stray `__session` key is left untouched for the tool to ignore).
   */
  sessionName?: string

  /**
   * Discovery directory holding the per-pid lockfiles of every live instance
   * of this app (see {@link resolveMcpDiscoveryDir}). When set together with
   * {@link sessionName}, the cross-instance bridge is active: a `tools/call`
   * naming another instance via `__session` is resolved against this dir and
   * forwarded to its loopback MCP endpoint (port + bearer token from its
   * lockfile), the response relayed verbatim. Unknown / dead / unreachable
   * name → a clean JSON-RPC error, never a hang.
   *
   * The app is responsible for WRITING its own lockfile into this dir on
   * startup (via {@link writeMcpDiscoveryFile}, with the bound port + token)
   * and cleaning it up on quit — McpService only consumes the dir for
   * forwarding. Omitted → no bridge (every call runs locally).
   */
  discoveryDir?: string

  /**
   * Optional path to an `ffmpeg` executable used to remux a captured
   * screencast WebM into a seekable, correctly-timed MP4 (see
   * {@link remuxScreencastToMp4}). ECUI never bundles ffmpeg — provisioning
   * a binary is a packaging concern of the consuming app, so an app that
   * wants the MP4 path to work without a system install ships its own
   * ffmpeg and passes the resolved on-disk path here.
   *
   * Omitted → ECUI invokes a bare `ffmpeg`, i.e. whatever is on the
   * process `PATH`. When no ffmpeg is reachable (neither an injected path
   * nor one on PATH), the remux degrades gracefully: `screencast-stop`
   * serves the raw WebM instead (still viewable; only the `<video>`
   * duration self-corrects as it buffers). So MP4 is a best-effort upgrade,
   * never a hard dependency.
   */
  ffmpegPath?: string
}

/**
 * Tool config object, matching the shape `McpServer.registerTool`
 * accepts as its second argument: title / description / optional
 * Zod-shape inputSchema / outputSchema / annotations / _meta. We type
 * it loosely (`Record<string, unknown>` for the schema slots) because
 * the SDK exposes multi-overloaded signatures that collapse to `never`
 * when picked through `Parameters<...>`.
 */
export interface McpToolConfig {
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
  /**
   * i18n KEY for a human-readable title shown in the MCP logs viewer (e.g.
   * `mcpToolTitles.evaluate`). REQUIRED — every registered tool must declare
   * one, so the viewer never falls back to a raw, opaque tool name and no
   * separate name→title map can drift out of sync. ECUI ships only the key;
   * the host resolves it through its i18n catalogue. The key rides on each
   * served-call log entry ({@link McpServedCallEntry.titleKey}).
   */
  titleKey: string
}

/**
 * Tool handler returns the standard MCP `CallToolResult` shape: a
 * `content` array of typed parts (`text`, `image`, `audio`, `resource`,
 * `resource_link`) plus an optional `isError` flag. Typed loosely for
 * the same reason as `McpToolConfig` above.
 */
export type McpToolHandler = (
  args: Record<string, unknown>,
  extra: unknown
) => unknown

interface ToolRegistration {
  name: string
  config: McpToolConfig
  handler: McpToolHandler
}

/**
 * Resource configuration. Mirrors the SDK's `ResourceMetadata` minus
 * the fields the SDK fills itself. `mimeType` defaults to
 * `application/json` for the `text` content path; pass it explicitly
 * for plain-text or binary payloads.
 */
export interface McpResourceConfig {
  title?: string
  description?: string
  mimeType?: string
}

/**
 * Resource handler returns either an inline text payload (most common
 * — JSON descriptions of project state) or a base64 blob for binary
 * content. The handler receives the parsed `URL` so it can pull
 * variables from a templated URI (e.g. `restorm://request/{id}`).
 */
export type McpResourceHandler = (uri: URL) => Promise<{
  text?: string
  blob?: string
  mimeType?: string
}> | {
  text?: string
  blob?: string
  mimeType?: string
}

interface ResourceRegistration {
  name: string
  uri: string
  config: McpResourceConfig
  handler: McpResourceHandler
}

/**
 * One entry in the renderer-console circular buffer surfaced by the
 * built-in `console-logs` tool.
 */
interface ConsoleLogEntry {
  timestamp: number
  level: string
  message: string
  source: string
  line: number
  windowId: number
}

/**
 * One captured visual artefact (a PNG screenshot or a WebM screencast)
 * a tool produced, kept alongside the served-call entry so a viewer can
 * render it inline. Held only for the most recent few entries to bound
 * memory — older entries keep their metadata but drop the heavy payload.
 */
export interface McpServedCapture {
  /** `image` for a base64 PNG (data URI-able), `video` for a screencast file. */
  kind: 'image' | 'video'
  /** MIME type, e.g. `image/png` or `video/webm`. */
  mimeType: string
  /** Inline base64 payload (PNG bytes for `image`, WebM bytes for `video`) so
   * the renderer can show it via a `data:` URL. Absent once evicted to save
   * memory. Video carries it because the renderer blocks `file://`. */
  base64?: string
  /** On-disk path for `video` (a temp file written by `screencast-stop`).
   * Kept for the MCP text result + as a fallback once `base64` is evicted. */
  path?: string
}

/**
 * One entry in the served-MCP-call ring buffer. Records a `tools/call`
 * that THIS instance executed locally (forwarded / passthrough calls are
 * never recorded — see {@link McpService.recordServedCall}). Payloads are
 * truncated past a size cap so a large request body can't grow the buffer
 * without bound.
 */
export interface McpServedCallEntry {
  /** Epoch milliseconds when the call was received. */
  timestamp: number
  /** The MCP tool name (the `name` of the `tools/call`). */
  tool: string
  /** The call arguments, JSON-stringified + truncated past the cap. */
  payload: string
  /** True when {@link payload} was elided because it exceeded the cap. */
  payloadTruncated: boolean
  /** Original payload byte length before truncation. */
  payloadBytes: number
  /** The tool's result, JSON-stringified + truncated past the cap. Absent
   * until the local handler resolves (captured by {@link attachResponseToLatest}). */
  response?: string
  /** True when {@link response} was elided because it exceeded the cap. */
  responseTruncated?: boolean
  /** A visual artefact this call produced, when the tool is a capture tool. */
  capture?: McpServedCapture
  /** i18n KEY for the tool's human-readable title, copied from the tool's
   * registration ({@link McpToolConfig.titleKey}). The viewer resolves it via
   * the host's i18n; absent only if the tool somehow wasn't in the registry. */
  titleKey?: string
}

/**
 * Marker stored via `AsyncLocalStorage` while an MCP tool handler is
 * in flight. Used by the dialog-bypass wrapper to know whether a
 * `dialog.showSave/Open/MessageBox` call is happening because of an
 * MCP tool (auto-resolve) or because the user clicked something
 * (real dialog). The structure is open for future tool-scoped fields.
 */
interface McpToolContext {
  toolName: string
}

const mcpToolContext = new AsyncLocalStorage<McpToolContext>()

/**
 * Pull the readable text payload out of a standard MCP `CallToolResult`
 * (`{ content: [{ type: 'text', text }] }`) so the served-call log shows the
 * actual response rather than the JSON-RPC envelope. Joins multiple text parts;
 * returns the whole result untouched when it isn't that shape.
 */
function extractResultText(result: unknown): unknown {
  if (result === null || typeof result !== 'object' || !('content' in result)) return result
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return result
  const texts = content
    .filter(
      (c): c is { type: string; text: string } =>
        c !== null &&
        typeof c === 'object' &&
        (c as { type?: unknown }).type === 'text' &&
        typeof (c as { text?: unknown }).text === 'string'
    )
    .map((c) => c.text)
  if (texts.length === 0) return result
  return texts.length === 1 ? texts[0] : texts.join('\n')
}

/** URL prefix the logs viewer uses to load a screencast clip the renderer
 * can't reach over `file://`. Resolved by {@link installScreencastMediaProtocol}. */
export const SCREENCAST_MEDIA_URL_PREFIX = 'ecui-media://screencast/'

/** True for a screencast temp-file basename we own (mp4 remux or raw webm).
 * Used to guard both protocol serving and temp-file cleanup against path
 * traversal / unrelated files. */
function isScreencastTempName(name: string): boolean {
  return name.startsWith('ecu-screencast-') && (name.endsWith('.mp4') || name.endsWith('.webm'))
}

let screencastMediaProtocolInstalled = false
/**
 * Register the `ecui-media://screencast/<file>` protocol handler that streams a
 * screencast `.webm` from the OS temp dir to the renderer. The renderer BLOCKS
 * `file://` resources, so a `<video src=file://…>` never loads; this privileged
 * scheme (declared in IPCManager's pre-ready list) does. Idempotent.
 *
 * Security: only serves files directly inside `tmpdir()` whose name matches the
 * screencast prefix — the path is reduced to its basename so `..` / nested
 * paths can't escape the temp dir.
 */
function installScreencastMediaProtocol(): void {
  if (screencastMediaProtocolInstalled) return
  screencastMediaProtocolInstalled = true
  protocol.handle('ecui-media', (request) => {
    try {
      const url = new URL(request.url)
      // host is the namespace ("screencast"); pathname is "/<basename>".
      const name = pathBasename(decodeURIComponent(url.pathname))
      if (url.host !== 'screencast' || !isScreencastTempName(name)) {
        return new Response('Not found', { status: 404 })
      }
      const filePath = pathJoin(tmpdir(), name)
      if (!existsSync(filePath)) return new Response('Gone', { status: 410 })
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (err) {
      logger.warn('ecui-media protocol: failed to serve', { error: String(err) })
      return new Response('Error', { status: 500 })
    }
  })
  logger.info('McpService: ecui-media screencast protocol registered')
}

/**
 * Best-effort sweep of leftover `ecu-screencast-*.{webm,mp4}` temp files from a
 * previously CRASHED run. The on-exit + eviction cleanups handle the normal
 * case, but a SIGKILL / power loss skips them, leaving orphans in the OS temp
 * dir. Run once at startup. Basename-guarded so it only ever touches our own
 * screencast temp files.
 */
function sweepOrphanScreencastFiles(): void {
  const dir = tmpdir()
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  let removed = 0
  for (const name of names) {
    if (!isScreencastTempName(name)) continue
    try {
      rmSync(pathJoin(dir, name), { force: true })
      removed++
    } catch { /* best-effort */ }
  }
  if (removed > 0) logger.info('McpService: swept orphan screencast temp files', { removed })
}

/**
 * Remux a freshly-captured screencast `.webm` into a seekable, correctly-timed
 * MP4 (H.264 / yuv420p / +faststart) via ffmpeg.
 *
 * Why: the `MediaRecorder` WebM has no Duration in its container header, so a
 * `<video>` reports duration `Infinity` until fully buffered (scrubber / time
 * wrong at first). The MP4 carries a real duration + moov-at-front so it's
 * correct from the start and plays everywhere. Returns the mp4 path on success,
 * or `null` when ffmpeg is unavailable / fails — the caller then falls back to
 * serving the raw webm (still viewable; the duration just self-corrects as it
 * buffers).
 *
 * `ffmpegPath` is the executable to run: an app-injected absolute path
 * ({@link McpServiceOptions.ffmpegPath}) when the consumer ships its own ffmpeg,
 * else a bare `'ffmpeg'` resolved off `PATH`. A missing binary makes `spawnSync`
 * fail with `ENOENT`, which is caught here and reported as `null` (→ webm
 * fallback), so neither an absent system ffmpeg nor an absent injected one ever
 * throws out of `screencast-stop`.
 *
 * Exported so unit tests can exercise the remux / fallback branches directly.
 */
export function remuxScreencastToMp4(
  webmPath: string,
  mp4Path: string,
  ffmpegPath = 'ffmpeg'
): string | null {
  try {
    const res = spawnSync(
      ffmpegPath,
      [
        '-y',
        '-i', webmPath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-an', // screencasts have no audio track
        mp4Path
      ],
      { stdio: 'ignore', timeout: 60_000 }
    )
    if (res.status === 0 && existsSync(mp4Path)) return mp4Path
    logger.warn('screencast: ffmpeg remux failed; serving raw webm', {
      status: res.status, error: res.error ? String(res.error) : undefined
    })
    return null
  } catch (err) {
    logger.warn('screencast: ffmpeg remux threw; serving raw webm', { error: String(err) })
    return null
  }
}

let dialogBypassInstalled = false
/**
 * Monkey-patches `electron.dialog.showSaveDialog`, `showOpenDialog` and
 * `showMessageBox` to short-circuit with synthetic results when called
 * from inside an MCP tool handler (detected via the
 * `mcpToolContext` `AsyncLocalStorage`). User-driven invocations
 * (menu clicks, internal flows outside an MCP request) keep the real
 * native dialog.
 *
 * Idempotent: only patches once per process. Installed lazily by
 * `McpService.start()` so apps that never enable MCP don't pay any
 * cost (and don't have their dialog stack altered).
 *
 * Synthetic results lean on `defaultPath` / `defaultId` from the
 * options the caller passed — those fields exist precisely so a UI
 * can pre-fill the dialog. When neither is present we return a
 * "cancelled" / "first button" result, which is the safest no-op.
 */
function installDialogBypass(): void {
  if (dialogBypassInstalled) return
  dialogBypassInstalled = true

  type SaveDialogFn = typeof electronDialog.showSaveDialog
  type OpenDialogFn = typeof electronDialog.showOpenDialog
  type MessageBoxFn = typeof electronDialog.showMessageBox

  const realShowSaveDialog: SaveDialogFn = electronDialog.showSaveDialog.bind(electronDialog)
  const realShowOpenDialog: OpenDialogFn = electronDialog.showOpenDialog.bind(electronDialog)
  const realShowMessageBox: MessageBoxFn = electronDialog.showMessageBox.bind(electronDialog)

  const dlg = electronDialog as unknown as Record<string, unknown>

  dlg['showSaveDialog'] = async (...args: unknown[]): Promise<Electron.SaveDialogReturnValue> => {
    const ctx = mcpToolContext.getStore()
    if (ctx) {
      const opts = (args[args.length - 1] as Electron.SaveDialogOptions | undefined) ?? {}
      logger.info('McpService dialog bypass: showSaveDialog', { tool: ctx.toolName, defaultPath: opts.defaultPath })
      return { canceled: !opts.defaultPath, filePath: opts.defaultPath ?? '' }
    }
    return realShowSaveDialog(...(args as Parameters<SaveDialogFn>))
  }

  dlg['showOpenDialog'] = async (...args: unknown[]): Promise<Electron.OpenDialogReturnValue> => {
    const ctx = mcpToolContext.getStore()
    if (ctx) {
      const opts = (args[args.length - 1] as Electron.OpenDialogOptions | undefined) ?? {}
      logger.info('McpService dialog bypass: showOpenDialog', { tool: ctx.toolName, defaultPath: opts.defaultPath })
      return { canceled: !opts.defaultPath, filePaths: opts.defaultPath ? [opts.defaultPath] : [] }
    }
    return realShowOpenDialog(...(args as Parameters<OpenDialogFn>))
  }

  dlg['showMessageBox'] = async (...args: unknown[]): Promise<Electron.MessageBoxReturnValue> => {
    const ctx = mcpToolContext.getStore()
    if (ctx) {
      // `showMessageBox(window?, options)` — options are required in
      // Electron's TS overload, but the wrapped arg list might be
      // either form. Pull the trailing options object defensively.
      const last = args[args.length - 1]
      const opts: Partial<Electron.MessageBoxOptions> = (last && typeof last === 'object') ? (last as Electron.MessageBoxOptions) : {}
      logger.info('McpService dialog bypass: showMessageBox', { tool: ctx.toolName, defaultId: opts.defaultId })
      return { response: opts.defaultId ?? 0, checkboxChecked: false }
    }
    return realShowMessageBox(...(args as Parameters<MessageBoxFn>))
  }
}

/**
 * Single-process MCP server bootstrap. Wraps `@modelcontextprotocol/sdk`
 * with a Node `http.Server` configured for Streamable HTTP and bound to
 * the loopback interface only — never exposed beyond `127.0.0.1`. Apps
 * register their domain tools through `registerTool(...)`; ECUI ships a
 * single built-in tool (`screenshot`) that all consumers can rely on.
 *
 * The MCP server is **off by default**: `start()` only opens the port
 * when called with a positive integer. The intended trigger is a CLI
 * flag in the consuming app (`--mcp-port=NNNN`), so production /
 * package builds never accidentally listen on a port.
 *
 * The transport runs in **stateless** mode: a fresh `McpServer` +
 * `StreamableHTTPServerTransport` pair is built per HTTP request. The
 * SDK forbids reusing a stateless transport across requests (it would
 * collide JSON-RPC IDs between callers), so the service keeps a
 * registry of tools and re-registers them onto each per-request
 * server. Lightweight in practice — `McpServer` construction +
 * `registerTool` are O(N) over the tool count.
 */
export class McpService {
  private httpServer: Server | null = null
  private readonly options: McpServiceOptions
  private readonly tools: ToolRegistration[] = []
  private readonly resources: ResourceRegistration[] = []
  private readonly logBuffer: ConsoleLogEntry[] = []
  private readonly logBufferMax = 1000
  private readonly attachedWebContentsIds = new Set<number>()
  private windowCreatedHandler: ((event: Electron.Event, win: BrowserWindow) => void) | null = null
  private readonly requestListeners = new Set<() => void>()

  /**
   * Ring buffer of `tools/call`s this instance executed LOCALLY. Forwarded
   * (cross-instance bridge) calls are never recorded — see
   * {@link recordServedCall}. Oldest entries are evicted once the buffer
   * exceeds {@link servedCallCap}.
   */
  private readonly servedCalls: McpServedCallEntry[] = []
  /** Configurable cap on {@link servedCalls}; default 100, clamped ≥ 0. */
  private servedCallCap = DEFAULT_SERVED_CALL_CAP
  /** Configurable count of most-recent entries that keep their heavy capture
   * payload (image base64 / video temp file); default 20, clamped ≥ 0. */
  private captureRetentionCap = DEFAULT_CAPTURE_RETENTION_CAP
  private readonly servedCallListeners = new Set<() => void>()

  constructor(options: McpServiceOptions = {}) {
    this.options = options
    this.registerBuiltinTools()
  }

  /**
   * Subscribe to an opaque "ping" emitted on every incoming MCP HTTP
   * request, just before the JSON-RPC handler runs. Used by consumers
   * to drive activity indicators in the UI (e.g. a ripple animation
   * on the MCP statusbar element). No payload — the event carries
   * nothing about the request itself; consumers don't need it for
   * activity-only purposes.
   *
   * Returns an unsubscribe function. Listener errors are caught + logged
   * so a buggy consumer can't take the request handler down with it.
   */
  onRequest(listener: () => void): () => void {
    this.requestListeners.add(listener)
    return () => { this.requestListeners.delete(listener) }
  }

  private notifyRequestListeners(): void {
    for (const fn of this.requestListeners) {
      try { fn() } catch (err) {
        logger.warn('McpService request listener threw', { error: String(err) })
      }
    }
  }

  /**
   * The served-MCP-call ring buffer, newest first. Each entry records a
   * `tools/call` this instance executed LOCALLY (forwarded calls excluded).
   * Returns a shallow copy so callers can't mutate the internal buffer.
   */
  getServedCalls(): McpServedCallEntry[] {
    // Newest-first matches the console-logs convention + reads naturally
    // in a log viewer (most recent at the top).
    return [...this.servedCalls].reverse()
  }

  /** Clear the served-call buffer (e.g. a "clear logs" button in the viewer). */
  clearServedCalls(): void {
    this.disposeEvictedMedia(this.servedCalls)
    this.servedCalls.length = 0
    this.notifyServedCallListeners()
  }

  /** The current served-call retention cap. */
  getLogRetentionCap(): number {
    return this.servedCallCap
  }

  /**
   * Set the served-call retention cap. Values are floored to a non-negative
   * integer; a smaller cap evicts the oldest entries immediately so the
   * buffer never exceeds the new size. A cap of 0 disables retention (and
   * drops anything currently buffered).
   */
  setLogRetentionCap(cap: number): void {
    const next = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : DEFAULT_SERVED_CALL_CAP
    this.servedCallCap = next
    if (this.servedCalls.length > next) {
      const dropped = this.servedCalls.splice(0, this.servedCalls.length - next)
      this.disposeEvictedMedia(dropped)
      this.notifyServedCallListeners()
    }
  }

  /** The current capture-retention cap (entries that keep their heavy payload). */
  getCaptureRetentionCap(): number {
    return this.captureRetentionCap
  }

  /**
   * Set how many of the most-recent entries keep their heavy capture payload
   * (image base64 / video temp file). Floored to a non-negative integer. A
   * smaller value prunes now — older captures drop their payload (and their
   * on-disk screencast temp file is deleted). Mirrors {@link setLogRetentionCap}.
   */
  setCaptureRetentionCap(cap: number): void {
    this.captureRetentionCap = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : DEFAULT_CAPTURE_RETENTION_CAP
    this.pruneOldCaptures()
    this.notifyServedCallListeners()
  }

  /**
   * Subscribe to served-call buffer changes (a call recorded, the buffer
   * cleared, or trimmed by a cap change). Used by the viewer to refresh
   * live. Returns an unsubscribe function; listener errors are isolated.
   */
  onServedCall(listener: () => void): () => void {
    this.servedCallListeners.add(listener)
    return () => { this.servedCallListeners.delete(listener) }
  }

  private notifyServedCallListeners(): void {
    for (const fn of this.servedCallListeners) {
      try { fn() } catch (err) {
        logger.warn('McpService served-call listener threw', { error: String(err) })
      }
    }
  }

  /**
   * Record a locally-executed `tools/call` in the ring buffer. Called from
   * {@link handleRequest} ONLY on the local-dispatch path — a request the
   * cross-instance bridge forwarded to a peer is answered before this runs,
   * so passthrough calls are never recorded (AC: passthrough exclusion).
   *
   * The `parsedBody` is the JSON-RPC envelope already parsed by the handler.
   * Non-`tools/call` methods (initialize / tools/list / notifications) and
   * malformed bodies are ignored. Large argument payloads are truncated past
   * {@link MCP_SERVED_PAYLOAD_MAX} so one big body can't bloat the buffer.
   */
  /**
   * Parse a buffered request body and record it if it's a `tools/call`.
   * A non-JSON / non-`tools/call` body is silently ignored. Wraps
   * {@link recordServedCall} so the buffering paths in {@link handleRequest}
   * stay terse.
   */
  private recordServedCallFromBuffer(raw: Buffer): void {
    if (this.servedCallCap <= 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }
    this.recordServedCall(parsed)
  }

  private recordServedCall(parsedBody: unknown): void {
    if (this.servedCallCap <= 0) return
    if (typeof parsedBody !== 'object' || parsedBody === null) return
    const msg = parsedBody as { method?: unknown; params?: { name?: unknown; arguments?: unknown } }
    if (msg.method !== 'tools/call') return
    const tool = typeof msg.params?.name === 'string' ? msg.params.name : ''
    if (!tool) return

    const args = msg.params?.arguments
    let payloadFull: string
    try {
      payloadFull = args === undefined ? '' : JSON.stringify(args)
    } catch {
      payloadFull = '"[unserialisable arguments]"'
    }
    const payloadBytes = Buffer.byteLength(payloadFull, 'utf8')
    const truncated = payloadBytes > MCP_SERVED_PAYLOAD_MAX
    const payload = truncated
      ? `${payloadFull.slice(0, MCP_SERVED_PAYLOAD_MAX)}…(truncated)`
      : payloadFull

    // Carry the tool's registered human-title i18n key onto the entry so the
    // viewer resolves it without any name→title map of its own.
    const titleKey = this.tools.find((t) => t.name === tool)?.config.titleKey
    const entry: McpServedCallEntry = {
      timestamp: Date.now(),
      tool,
      payload,
      payloadTruncated: truncated,
      payloadBytes,
      ...(titleKey !== undefined && { titleKey })
    }
    this.servedCalls.push(entry)
    if (this.servedCalls.length > this.servedCallCap) {
      const dropped = this.servedCalls.splice(0, this.servedCalls.length - this.servedCallCap)
      this.disposeEvictedMedia(dropped)
    }
    // Drop heavy capture payloads on all but the most recent few entries so
    // base64 PNGs / video paths don't accumulate unbounded in memory.
    this.pruneOldCaptures()
    this.notifyServedCallListeners()
  }

  /**
   * Attach a captured artefact (screenshot PNG / screencast video) to the
   * MOST RECENT served-call entry. Called by the capture tools after they
   * produce their result so a viewer can render it inline. No-op when the
   * buffer is empty (the tool ran but retention is off / nothing recorded).
   */
  private attachCaptureToLatest(capture: McpServedCapture): void {
    const latest = this.servedCalls[this.servedCalls.length - 1]
    if (!latest) return
    latest.capture = capture
    this.pruneOldCaptures()
    this.notifyServedCallListeners()
  }

  /**
   * Attach the result of a `tools/call` to the MOST RECENT served-call entry.
   * The request was recorded by {@link recordServedCall} immediately before the
   * SDK invoked the handler, so the latest entry IS this call (same assumption
   * as {@link attachCaptureToLatest}). Surfaces the readable text payload of a
   * standard MCP `CallToolResult` (`content:[{type:'text',text}]`) so the viewer
   * shows the actual response, not the envelope; falls back to the whole result.
   * Truncated past the same cap as the request. No-op when retention is off /
   * the buffer is empty.
   */
  private attachResponseToLatest(result: unknown): void {
    if (this.servedCallCap <= 0) return
    const latest = this.servedCalls[this.servedCalls.length - 1]
    if (!latest) return
    const readable = extractResultText(result)
    let full: string
    try {
      full = readable === undefined ? '' : typeof readable === 'string' ? readable : JSON.stringify(readable)
    } catch {
      full = '"[unserialisable result]"'
    }
    const truncated = Buffer.byteLength(full, 'utf8') > MCP_SERVED_PAYLOAD_MAX
    latest.response = truncated ? `${full.slice(0, MCP_SERVED_PAYLOAD_MAX)}…(truncated)` : full
    latest.responseTruncated = truncated
    this.notifyServedCallListeners()
  }

  /**
   * Bound capture memory + disk to the most-recent {@link captureRetentionCap}
   * entries: any older capture drops its heavy payload — image `base64` is
   * cleared, and a video's `path` (an `ecui-media://` URL) is dropped AND its
   * on-disk temp file deleted. Only the capture metadata (kind / mimeType)
   * stays, so the viewer shows "capture no longer available". Called after
   * every record / capture-attach and on a cap change.
   */
  private pruneOldCaptures(): void {
    const keepFrom = this.servedCalls.length - this.captureRetentionCap
    for (let i = 0; i < keepFrom; i++) {
      const e = this.servedCalls[i]
      if (!e?.capture) continue
      const { kind, mimeType, base64, path } = e.capture
      if (base64 === undefined && path === undefined) continue // already pruned
      // Delete the backing screencast temp file (video) before dropping the ref.
      this.disposeEvictedMedia([e])
      e.capture = { kind, mimeType }
    }
  }

  /**
   * Delete the on-disk screencast temp files backing the given evicted entries
   * so `/tmp` doesn't grow unbounded. A video capture's `path` is an
   * `ecui-media://screencast/<file>` URL → its temp file is `tmpdir()/<file>`.
   * Best-effort: a missing file or an unparsable path is ignored. Call with the
   * entries being dropped from the buffer (cap overflow / cap lowered / clear).
   */
  private disposeEvictedMedia(evicted: readonly McpServedCallEntry[]): void {
    for (const e of evicted) {
      const url = e.capture?.kind === 'video' ? e.capture.path : undefined
      if (!url?.startsWith(SCREENCAST_MEDIA_URL_PREFIX)) continue
      const name = pathBasename(url.slice(SCREENCAST_MEDIA_URL_PREFIX.length))
      if (!isScreencastTempName(name)) continue
      try {
        rmSync(pathJoin(tmpdir(), name), { force: true })
      } catch (err) {
        logger.warn('McpService: failed to delete evicted screencast temp file', { name, error: String(err) })
      }
    }
  }

  /**
   * Start listening on `127.0.0.1:port`. Throws if already running.
   * `port = 0` (or omitted) tells the OS to pick a free ephemeral port
   * — the consumer reads the actual bound value back via `getPort()`
   * once `start` resolves. Negative values mean "off" (the caller's
   * MCP toggle is disabled).
   */
  async start(port = 0): Promise<void> {
    if (port < 0) {
      logger.info('McpService: negative port, server stays off')
      return
    }
    if (this.httpServer) {
      throw new Error('McpService is already running')
    }

    // Install once, on first start. Idempotent — running multiple
    // McpService instances in the same process (rare; tests) doesn't
    // double-wrap the dialog API.
    installDialogBypass()
    installScreencastMediaProtocol()
    sweepOrphanScreencastFiles()
    this.attachConsoleSubscriptions()

    const httpServer = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
    this.httpServer = httpServer

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        httpServer.off('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        httpServer.off('error', onError)
        resolve()
      }
      httpServer.once('error', onError)
      httpServer.once('listening', onListening)
      // Bind to loopback only — never expose beyond the local
      // machine. Pairs with the in-handler IP filter below as a
      // belt-and-suspenders defence.
      httpServer.listen(port, '127.0.0.1')
    })

    const bound = this.getPort()
    logger.info('McpService listening', { port: bound, host: '127.0.0.1', tools: this.tools.length })
  }

  /**
   * The port the HTTP server is currently bound to, or `null` when
   * the service isn't running. Resolves the actual ephemeral port
   * picked by the OS when `start(0)` was used.
   */
  getPort(): number | null {
    if (!this.httpServer) return null
    const addr = this.httpServer.address()
    if (typeof addr === 'object' && addr !== null && 'port' in addr) {
      return addr.port
    }
    return null
  }

  /** Stop the HTTP server. Safe to call when not started. */
  async stop(): Promise<void> {
    if (this.windowCreatedHandler) {
      app.off('browser-window-created', this.windowCreatedHandler)
      this.windowCreatedHandler = null
    }
    if (this.httpServer) {
      const server = this.httpServer
      this.httpServer = null
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
    // Clean up any screencast temp files still referenced by the buffer so
    // `/tmp` doesn't accumulate webm files across runs.
    this.disposeEvictedMedia(this.servedCalls)
    logger.info('McpService stopped')
  }

  /**
   * Subscribe to `webContents.console-message` on every existing and
   * future `BrowserWindow` so the `console-logs` tool can return what
   * the renderer printed. Idempotent — the per-webContents id set
   * prevents double-attachment when the user spawns multiple windows
   * from the same `webContents` (rare but possible).
   */
  private attachConsoleSubscriptions(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      this.attachConsoleListenerToWindow(win)
    }
    if (!this.windowCreatedHandler) {
      this.windowCreatedHandler = (_event, win): void => { this.attachConsoleListenerToWindow(win) }
      app.on('browser-window-created', this.windowCreatedHandler)
    }
  }

  private attachConsoleListenerToWindow(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    const wcId = win.webContents.id
    if (this.attachedWebContentsIds.has(wcId)) return
    this.attachedWebContentsIds.add(wcId)
    // Electron's `console-message` event signature varies by version.
    // We accept either positional `(event, level, message, line, sourceId)`
    // or a single-object `(event)` shape and normalise both into a flat
    // entry.
    win.webContents.on('console-message', (...args: unknown[]) => {
      const entry = parseConsoleMessage(args, wcId)
      this.logBuffer.push(entry)
      if (this.logBuffer.length > this.logBufferMax) {
        this.logBuffer.splice(0, this.logBuffer.length - this.logBufferMax)
      }
    })
    win.webContents.once('destroyed', () => { this.attachedWebContentsIds.delete(wcId) })
  }

  /**
   * Register a tool. Stored in the in-memory registry; every
   * incoming MCP request gets a fresh `McpServer` populated with all
   * registered tools. Safe to call before or after `start()`.
   */
  registerTool(name: string, config: McpToolConfig, handler: McpToolHandler): void {
    if (this.tools.some((t) => t.name === name)) {
      throw new Error(`McpService.registerTool: tool "${name}" already registered`)
    }
    this.tools.push({ name, config, handler })
  }

  /**
   * The `(name, titleKey)` pair of every registered tool. Exposed so a host can
   * assert each title i18n key resolves in its locale catalogue (a CI guard
   * against "declared the key but forgot the translation").
   */
  getRegisteredToolTitleKeys(): { name: string; titleKey: string }[] {
    return this.tools.map((t) => ({ name: t.name, titleKey: t.config.titleKey }))
  }

  /**
   * Invoke a registered tool by name from inside the host process. The
   * built-in `batch` tool uses this to chain calls without going back
   * out through the HTTP transport. Throws if the tool is unknown.
   *
   * NOTE: this calls the handler directly, so it BYPASSES the SDK's
   * Zod `inputSchema` validation that an HTTP `tools/call` would run.
   * Tool handlers must therefore defensively coerce / clamp their own
   * args rather than trusting the schema (the built-ins do).
   */
  invokeTool(name: string, args: Record<string, unknown>, extra: unknown = {}): unknown {
    const entry = this.tools.find((t) => t.name === name)
    if (!entry) {
      throw new Error(`McpService.invokeTool: tool "${name}" is not registered`)
    }
    return entry.handler(args, extra)
  }

  /**
   * Register a resource. Each request gets a fresh `McpServer` populated
   * with the registry. Pass an exact URI (`restorm://project`) for a
   * static resource or a URI template (`restorm://request/{id}`) — the
   * SDK matches templates with `path-to-regexp` style placeholders, and
   * the handler receives the parsed `URL` so it can pull the bound
   * variables itself. The handler defaults `mimeType` to
   * `application/json` for text payloads when none is set.
   */
  registerResource(
    name: string,
    uri: string,
    config: McpResourceConfig,
    handler: McpResourceHandler
  ): void {
    if (this.resources.some((r) => r.name === name)) {
      throw new Error(`McpService.registerResource: resource "${name}" already registered`)
    }
    this.resources.push({ name, uri, config, handler })
  }

  private registerBuiltinTools(): void {
    this.registerTool(
      'screenshot',
      {
        titleKey: 'mcpToolTitles.screenshot',
        title: 'Screenshot',
        description:
          'Capture an Electron window as a PNG and return it base64-encoded. ' +
          'Use this to inspect the application UI state. Pass `windowId` to target a specific window in multi-window setups.',
        inputSchema: { windowId: windowIdSchema } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const image = await win.webContents.capturePage()
        const base64 = image.toPNG().toString('base64')
        // Surface the capture inline in the logs viewer (bonus). Attached to
        // the most-recent served-call entry — i.e. this very `screenshot`
        // call — and auto-evicted for older entries to bound memory.
        this.attachCaptureToLatest({ kind: 'image', mimeType: 'image/png', base64 })
        return {
          content: [{ type: 'image', data: base64, mimeType: 'image/png' }]
        }
      }
    )

    this.registerTool(
      'screencast-start',
      {
        titleKey: 'mcpToolTitles.screencastStart',
        title: 'Start screencast',
        description:
          'Begin recording the target Electron window as a WebM video. The clip is held in renderer memory ' +
          '(MediaRecorder + Blob chunks) until `screencast-stop` is called, which flushes it to a temp file ' +
          'and returns the path. No native dialog is shown — the source id is fetched from main via ' +
          '`BrowserWindow.getMediaSourceId()` and passed straight into `getUserMedia({ chromeMediaSourceId })`. ' +
          'Use as the animated counterpart to `screenshot`: call `screencast-start` → trigger the UI you want ' +
          'to demo → call `screencast-stop` → upload / inspect the WebM. Errors out cleanly if a screencast ' +
          'is already in progress on the target window.',
        inputSchema: {
          windowId: windowIdSchema,
          bitrate: z.coerce.number().int().min(100_000).max(50_000_000).optional().describe(
            'Target video bitrate in bits per second. Default 4_000_000 (4 Mbps) — a good trade-off between ' +
            'WebM file size and visual fidelity for UI demos.'
          ),
          maxWidth: z.coerce.number().int().min(64).max(7680).optional().describe(
            'Cap on the captured stream width in pixels. Default 1920. Smaller caps shrink the file ' +
            'proportionally, useful for thumbnail-sized demos.'
          ),
          maxHeight: z.coerce.number().int().min(64).max(4320).optional().describe(
            'Cap on the captured stream height in pixels. Default 1080.'
          ),
          maxFrameRate: z.coerce.number().int().min(1).max(60).optional().describe(
            'Target frame rate. Default 30. Animations driven by `prefers-reduced-motion: reduce` are still ' +
            'paused under that media query — drop the rate if you need a low-motion clip.'
          )
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const bitrate = typeof argRecord['bitrate'] === 'number' ? argRecord['bitrate'] : 4_000_000
        const maxWidth = typeof argRecord['maxWidth'] === 'number' ? argRecord['maxWidth'] : 1920
        const maxHeight = typeof argRecord['maxHeight'] === 'number' ? argRecord['maxHeight'] : 1080
        const maxFrameRate = typeof argRecord['maxFrameRate'] === 'number' ? argRecord['maxFrameRate'] : 30
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)

        // `BrowserWindow.getMediaSourceId()` returns a string consumable by
        // `getUserMedia({ video: { mandatory: { chromeMediaSourceId } } })`
        // for THIS window only — Electron's main process bypasses the
        // user-facing source picker that web `getDisplayMedia()` would
        // otherwise show.
        const mediaSourceId = win.getMediaSourceId()

        const code =
          `((mediaSourceId, bitrate, maxWidth, maxHeight, maxFrameRate) => new Promise((resolve, reject) => {
            (async () => {
              try {
                if (window.__ecuScreencast__) {
                  reject(new Error('A screencast is already in progress; call screencast-stop first'));
                  return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: {
                    mandatory: {
                      chromeMediaSource: 'desktop',
                      chromeMediaSourceId: mediaSourceId,
                      maxWidth: maxWidth,
                      maxHeight: maxHeight,
                      maxFrameRate: maxFrameRate
                    }
                  }
                });
                const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                  ? 'video/webm;codecs=vp9'
                  : 'video/webm';
                const recorder = new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: bitrate });
                const chunks = [];
                recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) { chunks.push(e.data); } };
                window.__ecuScreencast__ = { recorder: recorder, chunks: chunks, stream: stream, mimeType: mimeType, startedAt: Date.now() };
                recorder.start(250);
                resolve('started');
              } catch (err) {
                reject(err && err.message ? err : new Error(String(err)));
              }
            })();
          }))(${JSON.stringify(mediaSourceId)}, ${bitrate}, ${maxWidth}, ${maxHeight}, ${maxFrameRate})`

        try {
          await win.webContents.executeJavaScript(code, true)
          return { content: [{ type: 'text', text: 'Screencast started.' }] }
        } catch (err) {
          return {
            content: [
              { type: 'text', text: `Failed to start screencast: ${err instanceof Error ? err.message : String(err)}` }
            ],
            isError: true
          }
        }
      }
    )

    this.registerTool(
      'screencast-stop',
      {
        titleKey: 'mcpToolTitles.screencastStop',
        title: 'Stop screencast',
        description:
          'Stop the active screencast on the target window, flush the accumulated WebM chunks to a temp ' +
          'file and return the file path + clip metadata (byte length, duration, mime type). The recorder ' +
          'and the underlying MediaStream are torn down before this returns. Errors out if no screencast ' +
          'is currently running on the target window.',
        inputSchema: { windowId: windowIdSchema } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)

        // Renderer-side: stop the recorder, await the final `dataavailable`
        // emission via the `stop` event, concat the chunks and base64-encode
        // them so we can ship the bytes back through `executeJavaScript`'s
        // JSON-only IPC channel. 0x8000 = 32 KiB chunks for `String.fromCharCode.apply`,
        // which would blow the stack on larger spans.
        const code =
          `((maxChunkSize) => new Promise((resolve, reject) => {
            (async () => {
              try {
                const cap = window.__ecuScreencast__;
                if (!cap) { reject(new Error('No screencast in progress')); return; }
                await new Promise((res) => {
                  cap.recorder.addEventListener('stop', () => res(), { once: true });
                  cap.recorder.stop();
                });
                cap.stream.getTracks().forEach((t) => t.stop());
                const blob = new Blob(cap.chunks, { type: cap.mimeType });
                const buffer = new Uint8Array(await blob.arrayBuffer());
                let binary = '';
                for (let i = 0; i < buffer.byteLength; i += maxChunkSize) {
                  const slice = buffer.subarray(i, Math.min(i + maxChunkSize, buffer.byteLength));
                  binary += String.fromCharCode.apply(null, slice);
                }
                const base64 = btoa(binary);
                const result = { base64: base64, byteLength: buffer.byteLength, durationMs: Date.now() - cap.startedAt, mimeType: cap.mimeType };
                delete window.__ecuScreencast__;
                resolve(result);
              } catch (err) {
                reject(err && err.message ? err : new Error(String(err)));
              }
            })();
          }))(0x8000)`

        let result: { base64: string; byteLength: number; durationMs: number; mimeType: string }
        try {
          result = (await win.webContents.executeJavaScript(code, true)) as typeof result
        } catch (err) {
          return {
            content: [
              { type: 'text', text: `Failed to stop screencast: ${err instanceof Error ? err.message : String(err)}` }
            ],
            isError: true
          }
        }

        const buffer = Buffer.from(result.base64, 'base64')
        const stamp = Date.now()
        // A screencast can capture on-screen secrets — write it 0600 so
        // it isn't world-readable in the shared system temp dir. (The
        // file must stay directly in tmpdir(), not a subdir: the
        // `ecui-media://` protocol handler + the cleanup path resolve it
        // by basename under tmpdir() only.)
        const webmPath = pathJoin(tmpdir(), `ecu-screencast-${String(stamp)}.webm`)
        writeFileSync(webmPath, buffer, { mode: 0o600 })

        // The MediaRecorder webm has no Duration in its header, so a <video>
        // reports Infinity until fully buffered. Remux to a seekable MP4 with a
        // real duration (ffmpeg); serve that when it succeeds (and drop the
        // webm), else fall back to the raw webm.
        const mp4Path = pathJoin(tmpdir(), `ecu-screencast-${String(stamp)}.mp4`)
        const remuxed = remuxScreencastToMp4(webmPath, mp4Path, this.options.ffmpegPath)
        const servePath = remuxed ?? webmPath
        const serveMime = remuxed ? 'video/mp4' : result.mimeType
        if (remuxed) {
          try { rmSync(webmPath, { force: true }) } catch { /* best-effort */ }
        }

        // Surface the clip inline in the logs viewer (bonus). A clip can be
        // multiple MB, so we do NOT inline its base64 in the bounded buffer
        // (that bloated memory + every getLogs IPC, and the clip evicted within
        // a few calls). Instead the renderer loads it on demand from disk via
        // the `ecui-media://` protocol — the renderer blocks `file://`, but the
        // privileged scheme streams the temp file. `path` carries that URL.
        this.attachCaptureToLatest({
          kind: 'video',
          mimeType: serveMime,
          path: `${SCREENCAST_MEDIA_URL_PREFIX}${pathBasename(servePath)}`
        })

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                path: servePath,
                byteLength: result.byteLength,
                durationMs: result.durationMs,
                mimeType: serveMime
              })
            }
          ]
        }
      }
    )

    this.registerTool(
      'refresh',
      {
        titleKey: 'mcpToolTitles.refresh',
        title: 'Refresh',
        description:
          'Reload an Electron window\'s renderer. Equivalent to Ctrl+R / Cmd+R. ' +
          'Useful to re-roll randomized UI (wallpapers, animations) or recover from a renderer-side ' +
          'error without restarting the app. Resolves once the page emits `did-finish-load`. ' +
          'Pass `windowId` to target a specific window.',
        inputSchema: { windowId: windowIdSchema } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        await new Promise<void>((resolve) => {
          win.webContents.once('did-finish-load', () => { resolve() })
          win.webContents.reload()
        })
        return {
          content: [{ type: 'text', text: 'Reloaded.' }]
        }
      }
    )

    this.registerTool(
      'dom-query',
      {
        titleKey: 'mcpToolTitles.domQuery',
        title: 'Query DOM',
        description:
          'Run a CSS selector against the active renderer window and return matching elements as ' +
          'structured JSON (tag, id, classes, attributes, trimmed text content, bounding rect). ' +
          'Use to verify UI state, locate elements by data-testid, or read computed text. ' +
          'Truncates each element\'s text to 500 chars and the match list to `maxMatches` (default 50, max 200).',
        inputSchema: {
          selector: z.string().min(1).describe(
            'CSS selector to query. Examples: "[data-testid=\\"welcome-new-button\\"]", "main h1", ".ecu-recent-files-vignette-row".'
          ),
          maxMatches: z.coerce.number().int().min(1).max(200).optional().describe(
            'Maximum number of matches to return (default 50, max 200). Result includes a `truncated: true` flag when more matches existed.'
          ),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const selector = typeof argRecord['selector'] === 'string' ? argRecord['selector'] : ''
        if (!selector) {
          return {
            content: [{ type: 'text', text: 'selector is required' }],
            isError: true
          }
        }
        const rawMax = typeof argRecord['maxMatches'] === 'number' ? argRecord['maxMatches'] : 50
        const max = Math.max(1, Math.min(200, Math.floor(rawMax)))
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        // Single-statement IIFE so `executeJavaScript` returns a value
        // (the SDK's `userGesture: true` path requires an expression
        // result). Errors are caught in-page so we surface them as
        // `isError` tool results rather than rejected promises.
        const code = `((sel, max) => { try { ` +
          `const els = Array.from(document.querySelectorAll(sel)); ` +
          `return { selector: sel, matchCount: els.length, truncated: els.length > max, elements: els.slice(0, max).map(el => { ` +
            `const r = el.getBoundingClientRect(); ` +
            `const cls = (el.className && typeof el.className === 'string') ? el.className.split(/\\s+/).filter(Boolean) : []; ` +
            `const attrs = {}; for (const a of Array.from(el.attributes)) { if (a.name !== 'class' && a.name !== 'id') attrs[a.name] = a.value; } ` +
            `return { tag: el.tagName.toLowerCase(), id: el.id || null, classes: cls, attributes: attrs, ` +
              `text: (el.textContent || '').trim().slice(0, 500), ` +
              `rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } }; ` +
          `}) }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(selector)}, ${max})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { selector: string; matchCount: number; truncated: boolean; elements: unknown[] }
        if ('error' in result) {
          return {
            content: [{ type: 'text', text: `DOM query failed: ${result.error}` }],
            isError: true
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }
    )

    this.registerTool(
      'console-logs',
      {
        titleKey: 'mcpToolTitles.consoleLogs',
        title: 'Renderer console logs',
        description:
          'Return recent renderer-process console messages (info / warn / error / debug / verbose). ' +
          'The buffer is filled automatically from the moment `McpService.start()` runs and caps at 1000 entries (oldest evicted first). ' +
          'Use to diagnose runtime errors, watch app-emitted logs, verify a `console.log(...)` made it through. ' +
          'Optional filters: `level` (specific severity), `since` (epoch ms — only entries newer than this), `limit` (default 100, max 1000), `windowId`.',
        inputSchema: {
          level: z.enum(['verbose', 'debug', 'info', 'warning', 'error']).optional().describe(
            'Only return entries at this exact level. Omit to return all levels.'
          ),
          since: z.coerce.number().int().nonnegative().optional().describe(
            'Epoch milliseconds. Only return entries with `timestamp >= since`. Useful for "what happened in the last N seconds".'
          ),
          limit: z.coerce.number().int().min(1).max(1000).optional().describe(
            'Maximum number of entries to return (default 100, max 1000). Most recent first.'
          ),
          windowId: z.coerce.number().int().optional().describe(
            'Filter to entries from a specific BrowserWindow (`webContents.id`). Omit for all windows.'
          )
        } as Record<string, unknown>
      },
      (args) => {
        const argRecord = args
        const levelFilter = typeof argRecord['level'] === 'string' ? argRecord['level'] : null
        const since = typeof argRecord['since'] === 'number' ? argRecord['since'] : 0
        const rawLimit = typeof argRecord['limit'] === 'number' ? argRecord['limit'] : 100
        const limit = Math.max(1, Math.min(1000, Math.floor(rawLimit)))
        const windowFilter = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : null

        // Iterate newest-first so we can stop as soon as we've
        // collected `limit` entries that match the filters.
        const out: ConsoleLogEntry[] = []
        for (let i = this.logBuffer.length - 1; i >= 0 && out.length < limit; i--) {
          const e = this.logBuffer[i]
          if (!e) continue
          if (levelFilter && e.level !== levelFilter) continue
          if (since && e.timestamp < since) continue
          if (windowFilter !== null && e.windowId !== windowFilter) continue
          out.push(e)
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ count: out.length, totalBuffered: this.logBuffer.length, entries: out }, null, 2) }]
        }
      }
    )

    this.registerTool(
      'dispatch-event',
      {
        titleKey: 'mcpToolTitles.dispatchEvent',
        title: 'Dispatch DOM event',
        description:
          'Dispatch a synthetic event of any type on a CSS-selected element in the active renderer. ' +
          'Picks the right Event constructor based on the event type (Mouse, Keyboard, Pointer, Wheel, Focus, fallback `Event`) ' +
          'and merges the optional `init` dict into the event\'s init. Defaults `bubbles: true`, `cancelable: true`, `composed: true`. ' +
          'For mouse-family events, the rect of the element is used to fill `clientX/clientY` automatically when omitted. ' +
          'Examples: click → `{ selector, type: "click" }`. Hover → `{ selector, type: "mouseenter" }`. ' +
          'Focus → `{ selector, type: "focus" }` (also calls `el.focus()`). Press Enter → ' +
          '`{ selector, type: "keydown", init: { key: "Enter", code: "Enter" } }`.',
        inputSchema: {
          selector: z.string().min(1).describe(
            'CSS selector of the target element. The first match is used; matching nothing is an error.'
          ),
          type: z.string().min(1).describe(
            'Event type, e.g. "click", "mouseenter", "pointerdown", "keydown", "focus", "blur", "wheel", or any custom event name.'
          ),
          init: jsonOrNative(z.record(z.string(), z.unknown())).optional().describe(
            'Optional init dict merged into the event. Keys depend on the event type (e.g. `button`, `clientX`, `key`, `deltaY`). ' +
            'Accepts either an object or a JSON-stringified object for compatibility with MCP clients that serialise complex args.'
          ),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const selector = typeof argRecord['selector'] === 'string' ? argRecord['selector'] : ''
        const eventType = typeof argRecord['type'] === 'string' ? argRecord['type'] : ''
        const init = (argRecord['init'] && typeof argRecord['init'] === 'object') ? argRecord['init'] : {}
        if (!selector || !eventType) {
          return {
            content: [{ type: 'text', text: 'selector and type are required' }],
            isError: true
          }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const code = `((sel, type, init) => { try { ` +
          `const el = document.querySelector(sel); ` +
          `if (!el) return { error: 'No element matches selector: ' + sel }; ` +
          `const rect = el.getBoundingClientRect(); ` +
          `const cx = rect.x + rect.width/2, cy = rect.y + rect.height/2; ` +
          `const baseInit = Object.assign({ bubbles: true, cancelable: true, composed: true }, init || {}); ` +
          `const mouse = new Set(['click','auxclick','dblclick','mousedown','mouseup','mouseenter','mouseleave','mousemove','mouseover','mouseout','contextmenu']); ` +
          `const keyboard = new Set(['keydown','keyup','keypress']); ` +
          `const pointer = new Set(['pointerdown','pointerup','pointermove','pointerenter','pointerleave','pointerover','pointerout','pointercancel']); ` +
          `const focusE = new Set(['focus','blur','focusin','focusout']); ` +
          `const wheel = new Set(['wheel']); ` +
          `let ev; ` +
          `if (mouse.has(type)) ev = new MouseEvent(type, Object.assign({ clientX: cx, clientY: cy, button: 0 }, baseInit)); ` +
          `else if (keyboard.has(type)) ev = new KeyboardEvent(type, baseInit); ` +
          `else if (pointer.has(type)) ev = new PointerEvent(type, Object.assign({ clientX: cx, clientY: cy }, baseInit)); ` +
          `else if (wheel.has(type)) ev = new WheelEvent(type, baseInit); ` +
          `else if (focusE.has(type)) ev = new FocusEvent(type, baseInit); ` +
          `else ev = new Event(type, baseInit); ` +
          // For focus/blur the imperative call is more reliable than
          // a synthetic FocusEvent (browsers gate real focus on user
          // gesture and won't move it via dispatchEvent alone).
          `if (type === 'focus' && typeof el.focus === 'function') el.focus(); ` +
          `else if (type === 'blur' && typeof el.blur === 'function') el.blur(); ` +
          `const dispatched = el.dispatchEvent(ev); ` +
          `return { dispatched: true, defaultPrevented: ev.defaultPrevented, returnValue: dispatched, selector: sel, type: type }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(selector)}, ${JSON.stringify(eventType)}, ${JSON.stringify(init)})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { dispatched: true; defaultPrevented: boolean; returnValue: boolean; selector: string; type: string }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `dispatch-event failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'type-text',
      {
        titleKey: 'mcpToolTitles.typeText',
        title: 'Type text into input',
        description:
          'Set the value of an `<input>`, `<textarea>` or `[contenteditable]` element and fire `input`+`change` events. ' +
          'Uses the native HTMLElement value setter (`Object.getOwnPropertyDescriptor(...).set.call(el, text)`) so React ' +
          'controlled inputs see the change — a plain `el.value = text` would be cached by React and ignored. ' +
          'Mode `replace` (default) overwrites the field; `append` concatenates onto the existing value.',
        inputSchema: {
          selector: z.string().min(1).describe('CSS selector of the input/textarea/contenteditable element.'),
          text: z.string().describe('Text to set or append. Use "" to clear.'),
          mode: z.enum(['replace', 'append']).optional().describe('Default `replace`. `append` concatenates onto existing text.'),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const selector = typeof argRecord['selector'] === 'string' ? argRecord['selector'] : ''
        const text = typeof argRecord['text'] === 'string' ? argRecord['text'] : ''
        const mode = argRecord['mode'] === 'append' ? 'append' : 'replace'
        if (!selector) {
          return { content: [{ type: 'text', text: 'selector is required' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const code = `((sel, text, mode) => { try { ` +
          `const el = document.querySelector(sel); ` +
          `if (!el) return { error: 'No element matches selector: ' + sel }; ` +
          `const tag = el.tagName.toLowerCase(); ` +
          `if (tag === 'input' || tag === 'textarea') { ` +
            `const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; ` +
            `const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; ` +
            `const next = mode === 'append' ? (el.value || '') + text : text; ` +
            `setter.call(el, next); ` +
            `el.dispatchEvent(new Event('input', { bubbles: true })); ` +
            `el.dispatchEvent(new Event('change', { bubbles: true })); ` +
            `return { ok: true, value: el.value }; ` +
          `} ` +
          `if (el.isContentEditable) { ` +
            `const next = mode === 'append' ? (el.textContent || '') + text : text; ` +
            `el.textContent = next; ` +
            `el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: mode === 'append' ? 'insertText' : 'insertReplacementText' })); ` +
            `return { ok: true, value: el.textContent }; ` +
          `} ` +
          `return { error: 'Element is not an input/textarea/contenteditable: ' + tag }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${JSON.stringify(mode)})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { ok: true; value: string }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `type-text failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'evaluate',
      {
        titleKey: 'mcpToolTitles.evaluate',
        title: 'Evaluate JS in renderer',
        description:
          'Power-tool escape hatch: run an arbitrary JavaScript expression in the active renderer\'s main world ' +
          'and return the result (passed through `JSON.stringify` so functions / undefined / circular refs become null). ' +
          'Use sparingly — every other tool covers the safe cases. Footgun by design: a misplaced statement can ' +
          'break the running app or leave it in a state the user notices.',
        inputSchema: {
          expression: z.string().min(1).describe(
            'JavaScript expression to evaluate. Wrap multi-statement code in an IIFE: `(() => { ...; return x })()`.'
          ),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const expression = typeof argRecord['expression'] === 'string' ? argRecord['expression'] : ''
        if (!expression) {
          return { content: [{ type: 'text', text: 'expression is required' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        // Wrap the user's expression in a try/catch so a syntax /
        // runtime error becomes a structured tool-result instead of
        // a rejected promise the SDK then surfaces as a 500.
        const code = `(() => { try { ` +
          `const __res = (${expression}); ` +
          `return { result: __res === undefined ? null : JSON.parse(JSON.stringify(__res)) }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})()`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { result: unknown }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `evaluate failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'exit',
      {
        titleKey: 'mcpToolTitles.exit',
        title: 'Quit the app',
        description:
          'Gracefully quit the Electron app via `app.quit()`. Pending file-dirty / before-quit handlers still run, ' +
          'so this is NOT a kill — if the user has unsaved changes the app may prompt and bail. ' +
          'Use to wind the GUI app down between dev iterations without leaving zombie processes.'
      },
      () => {
        // Defer the actual quit so the JSON-RPC response can be
        // serialised and sent before the event loop tears down.
        // 50ms is enough for the SDK to flush the SSE reply.
        setTimeout(() => { app.quit() }, 50)
        return { content: [{ type: 'text', text: 'Quit scheduled.' }] }
      }
    )

    this.registerTool(
      'wait-for',
      {
        titleKey: 'mcpToolTitles.waitFor',
        title: 'Wait for DOM condition',
        description:
          'Poll the renderer DOM until a condition is met (or `timeoutMs` elapses). Eliminates ' +
          'race conditions in tool-chains: `dispatch-event` click → `wait-for` modal appears → `screenshot`. ' +
          'Conditions: `present` (selector matches at least one element), `absent` (no match), ' +
          '`text-equals` (matched element\'s textContent === value), `text-contains` (textContent includes value), ' +
          '`attribute-equals` (matched element\'s getAttribute(name) === value).',
        inputSchema: {
          selector: z.string().min(1).describe('CSS selector to watch.'),
          condition: z.enum(['present', 'absent', 'text-equals', 'text-contains', 'attribute-equals']).describe(
            'How to compare. `present`/`absent` ignore `value` and `attribute`. ' +
            '`text-*` need `value`. `attribute-equals` needs `attribute` + `value`.'
          ),
          value: z.string().optional().describe('Expected text or attribute value (depends on `condition`).'),
          attribute: z.string().optional().describe('Attribute name for `attribute-equals`.'),
          timeoutMs: z.coerce.number().int().min(50).max(60_000).optional().describe('Max wait in ms (default 5000, max 60000).'),
          pollMs: z.coerce.number().int().min(20).max(2000).optional().describe('Poll interval in ms (default 100).'),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const selector = typeof argRecord['selector'] === 'string' ? argRecord['selector'] : ''
        const condition = typeof argRecord['condition'] === 'string' ? argRecord['condition'] : ''
        const value = typeof argRecord['value'] === 'string' ? argRecord['value'] : null
        const attribute = typeof argRecord['attribute'] === 'string' ? argRecord['attribute'] : null
        const rawTimeout = typeof argRecord['timeoutMs'] === 'number' ? argRecord['timeoutMs'] : 5000
        const timeoutMs = Math.max(50, Math.min(60_000, Math.floor(rawTimeout)))
        const rawPoll = typeof argRecord['pollMs'] === 'number' ? argRecord['pollMs'] : 100
        const pollMs = Math.max(20, Math.min(2000, Math.floor(rawPoll)))
        if (!selector || !condition) {
          return { content: [{ type: 'text', text: 'selector and condition are required' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        // Single-shot poll loop in the renderer — avoids the round-trip
        // overhead of N executeJavaScript calls. Returns as soon as the
        // condition matches or the deadline passes.
        const code = `(async (sel, cond, val, attr, timeoutMs, pollMs) => { ` +
          `const start = Date.now(); ` +
          `const deadline = start + timeoutMs; ` +
          `const check = () => { ` +
            `const el = document.querySelector(sel); ` +
            `if (cond === 'present') return !!el; ` +
            `if (cond === 'absent') return !el; ` +
            `if (!el) return false; ` +
            `if (cond === 'text-equals') return (el.textContent || '').trim() === val; ` +
            `if (cond === 'text-contains') return (el.textContent || '').includes(val); ` +
            `if (cond === 'attribute-equals') return el.getAttribute(attr) === val; ` +
            `return false; ` +
          `}; ` +
          `while (Date.now() < deadline) { ` +
            `if (check()) return { ok: true, elapsedMs: Date.now() - start }; ` +
            `await new Promise(r => setTimeout(r, pollMs)); ` +
          `} ` +
          `return { ok: false, timedOut: true, condition: cond, selector: sel }; ` +
          `})(${JSON.stringify(selector)}, ${JSON.stringify(condition)}, ${JSON.stringify(value)}, ${JSON.stringify(attribute)}, ${timeoutMs}, ${pollMs})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { ok: true; elapsedMs: number }
          | { ok: false; timedOut: true; condition: string; selector: string }
        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `wait-for timed out after ${String(timeoutMs)}ms — condition "${condition}" still false on selector ${selector}` }],
            isError: true
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'keyboard-shortcut',
      {
        titleKey: 'mcpToolTitles.keyboardShortcut',
        title: 'Send keyboard shortcut',
        description:
          'Send an OS-level keyboard event via `webContents.sendInputEvent` so Electron menu accelerators ' +
          '(`File → Save = Ctrl+S`, etc.) actually fire. Plain `dispatch-event` with a `KeyboardEvent` only ' +
          'reaches DOM listeners — it bypasses the Electron-level accelerator dispatch. Use this for any ' +
          'shortcut handled by `MenuItem.accelerator` or registered via `globalShortcut`.',
        inputSchema: {
          key: z.string().min(1).describe(
            'Key name. Letters: "A"–"Z", digits: "0"–"9", named keys: "Enter", "Escape", "Tab", "Space", ' +
            '"ArrowUp"/"ArrowDown"/"ArrowLeft"/"ArrowRight", "F1"–"F24", "Delete", "Backspace".'
          ),
          modifiers: jsonOrNative(z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta', 'Cmd', 'Ctrl', 'Super']))).optional().describe(
            'Modifier keys held during the press. "Cmd" is an alias for "Meta", "Ctrl" for "Control". ' +
            'Accepts either an array or a JSON-stringified array.'
          ),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      (args) => {
        const argRecord = args
        const key = typeof argRecord['key'] === 'string' ? argRecord['key'] : ''
        const rawMods = Array.isArray(argRecord['modifiers']) ? argRecord['modifiers'] : []
        const modifiers = rawMods
          .filter((m): m is string => typeof m === 'string')
          .map((m) => (m === 'Cmd' ? 'Meta' : m === 'Ctrl' ? 'Control' : m))
        if (!key) {
          return { content: [{ type: 'text', text: 'key is required' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        // sendInputEvent's `keyCode` accepts named keys for Electron;
        // see https://www.electronjs.org/docs/latest/api/accelerator
        // for the canonical list. Pass through as-is.
        type InputEvt = Parameters<typeof win.webContents.sendInputEvent>[0]
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers } as InputEvt)
        win.webContents.sendInputEvent({ type: 'char', keyCode: key, modifiers } as InputEvt)
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers } as InputEvt)
        return {
          content: [{ type: 'text', text: JSON.stringify({ sent: true, key, modifiers }, null, 2) }]
        }
      }
    )

    this.registerTool(
      'devtools',
      {
        titleKey: 'mcpToolTitles.devtools',
        title: 'Toggle Chromium DevTools',
        description:
          'Open / close / toggle the renderer\'s DevTools panel. Useful when you need to inspect the DOM, ' +
          'view the JS console, or debug network — without asking the user to do it manually.',
        inputSchema: {
          action: z.enum(['open', 'close', 'toggle']).describe('Default `toggle`.').optional(),
          mode: z.enum(['right', 'bottom', 'left', 'undocked', 'detach']).optional().describe(
            'How DevTools opens (Electron WebContentsOpenDevToolsOptions). Default `right`.'
          ),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      (args) => {
        const argRecord = args
        const action = typeof argRecord['action'] === 'string' ? argRecord['action'] : 'toggle'
        const mode = typeof argRecord['mode'] === 'string' ? argRecord['mode'] : 'right'
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const wc = win.webContents
        const wasOpen = wc.isDevToolsOpened()
        // `openDevTools` / `closeDevTools` schedule the window
        // asynchronously — reading `isDevToolsOpened()` straight
        // after returns the pre-call state, so we report the
        // **intended** target instead of the observed one.
        let intendedOpen = wasOpen
        if (action === 'open' && !wasOpen) {
          wc.openDevTools({ mode } as Electron.OpenDevToolsOptions)
          intendedOpen = true
        } else if (action === 'close' && wasOpen) {
          wc.closeDevTools()
          intendedOpen = false
        } else if (action === 'toggle') {
          if (wasOpen) { wc.closeDevTools(); intendedOpen = false }
          else { wc.openDevTools({ mode } as Electron.OpenDevToolsOptions); intendedOpen = true }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ action, was: wasOpen ? 'open' : 'closed', now: intendedOpen ? 'open' : 'closed' }, null, 2) }]
        }
      }
    )

    this.registerTool(
      'window-info',
      {
        titleKey: 'mcpToolTitles.windowInfo',
        title: 'Window info',
        description:
          'Return a snapshot of a BrowserWindow: bounds, content size, title, focus / minimize / maximize / fullscreen / visible flags. ' +
          'Use as a quick diagnostic before / after a `screenshot` (e.g. detect a minimized window — its capture would be empty). ' +
          'Pass `windowId` to inspect a specific window (see `get-windows` for the live id list); omit for the focused / first-visible window.',
        inputSchema: { windowId: windowIdSchema } as Record<string, unknown>
      },
      (args) => {
        const argRecord = args
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const bounds = win.getBounds()
        const contentBounds = win.getContentBounds()
        const info = {
          id: win.webContents.id,
          title: win.getTitle(),
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          contentBounds: { x: contentBounds.x, y: contentBounds.y, width: contentBounds.width, height: contentBounds.height },
          isFocused: win.isFocused(),
          isVisible: win.isVisible(),
          isMinimized: win.isMinimized(),
          isMaximized: win.isMaximized(),
          isFullScreen: win.isFullScreen(),
          isAlwaysOnTop: win.isAlwaysOnTop(),
          isDestroyed: win.isDestroyed(),
          devToolsOpened: win.webContents.isDevToolsOpened()
        }
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
      }
    )

    this.registerTool(
      'storage',
      {
        titleKey: 'mcpToolTitles.storage',
        title: 'Renderer localStorage',
        description:
          'Read or modify the renderer\'s `localStorage`. Useful to set up app state (recent files, settings, ' +
          'persisted UI flags) without going through the UI, or to inspect what the app persisted between sessions. ' +
          'Operates on the active window\'s document.',
        inputSchema: {
          action: z.enum(['get', 'set', 'remove', 'clear', 'keys']).describe(
            '`get` → read one key. `set` → write one key. `remove` → delete one key. `clear` → wipe all. `keys` → list every key.'
          ),
          key: z.string().optional().describe('Required for `get`, `set`, `remove`. Ignored for `clear`/`keys`.'),
          value: z.string().optional().describe('Required for `set`. localStorage stores strings — pass JSON-stringified data if you need structure.'),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const action = typeof argRecord['action'] === 'string' ? argRecord['action'] : ''
        const key = typeof argRecord['key'] === 'string' ? argRecord['key'] : null
        const value = typeof argRecord['value'] === 'string' ? argRecord['value'] : null
        if (!action) {
          return { content: [{ type: 'text', text: 'action is required' }], isError: true }
        }
        if ((action === 'get' || action === 'set' || action === 'remove') && key === null) {
          return { content: [{ type: 'text', text: `${action} requires "key"` }], isError: true }
        }
        if (action === 'set' && value === null) {
          return { content: [{ type: 'text', text: 'set requires "value"' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const code = `((action, key, value) => { try { ` +
          `if (action === 'get') return { value: localStorage.getItem(key) }; ` +
          `if (action === 'set') { localStorage.setItem(key, value); return { ok: true }; } ` +
          `if (action === 'remove') { localStorage.removeItem(key); return { ok: true }; } ` +
          `if (action === 'clear') { localStorage.clear(); return { ok: true }; } ` +
          `if (action === 'keys') { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== null) keys.push(k); } return { keys: keys.sort() }; } ` +
          `return { error: 'Unknown action: ' + action }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(action)}, ${JSON.stringify(key)}, ${JSON.stringify(value)})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { value: string | null }
          | { ok: true }
          | { keys: string[] }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `storage failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'scroll-into-view',
      {
        titleKey: 'mcpToolTitles.scrollIntoView',
        title: 'Scroll element into view',
        description:
          'Call `el.scrollIntoView(...)` on a CSS-selected element so a downstream `screenshot` / `dispatch-event` ' +
          'sees it. Useful for tall list views, long forms, or anything that needs to be on-screen first.',
        inputSchema: {
          selector: z.string().min(1).describe('CSS selector of the element to scroll into view.'),
          behavior: z.enum(['auto', 'smooth', 'instant']).optional().describe('Default `instant` — no animation, faster.'),
          block: z.enum(['start', 'center', 'end', 'nearest']).optional().describe('Vertical alignment. Default `center`.'),
          inline: z.enum(['start', 'center', 'end', 'nearest']).optional().describe('Horizontal alignment. Default `nearest`.'),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const selector = typeof argRecord['selector'] === 'string' ? argRecord['selector'] : ''
        const behavior = typeof argRecord['behavior'] === 'string' ? argRecord['behavior'] : 'instant'
        const block = typeof argRecord['block'] === 'string' ? argRecord['block'] : 'center'
        const inline = typeof argRecord['inline'] === 'string' ? argRecord['inline'] : 'nearest'
        if (!selector) {
          return { content: [{ type: 'text', text: 'selector is required' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const code = `((sel, opts) => { try { ` +
          `const el = document.querySelector(sel); ` +
          `if (!el) return { error: 'No element matches selector: ' + sel }; ` +
          `el.scrollIntoView(opts); ` +
          `const r = el.getBoundingClientRect(); ` +
          `return { ok: true, rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(selector)}, ${JSON.stringify({ behavior, block, inline })})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { ok: true; rect: { x: number; y: number; width: number; height: number } }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `scroll-into-view failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'inject-css',
      {
        titleKey: 'mcpToolTitles.injectCss',
        title: 'Inject CSS rules',
        description:
          'Append a `<style>` tag with arbitrary CSS rules into the renderer\'s document head. Useful to debug ' +
          'hover/focus/active states (force a class), highlight elements with an outline, or test a layout tweak ' +
          'live without a rebuild. Tag has `data-mcp-inject-id` for later removal via `dispatch-event` or `evaluate`.',
        inputSchema: {
          rules: z.string().min(1).describe('Raw CSS to inject (one or more rules).'),
          id: z.string().optional().describe(
            'Optional id for the injected `<style>` tag. If a tag with the same `data-mcp-inject-id` exists, ' +
            'it is replaced (idempotent). Default: a generated id you can read back.'
          ),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const rules = typeof argRecord['rules'] === 'string' ? argRecord['rules'] : ''
        const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
        if (!rules) {
          return { content: [{ type: 'text', text: 'rules is required' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const code = `((rules, id) => { try { ` +
          `const tagId = id || ('mcp-inject-' + Math.random().toString(36).slice(2)); ` +
          `let style = document.querySelector('style[data-mcp-inject-id=\"' + tagId + '\"]'); ` +
          `const replaced = !!style; ` +
          `if (!style) { style = document.createElement('style'); style.setAttribute('data-mcp-inject-id', tagId); document.head.appendChild(style); } ` +
          `style.textContent = rules; ` +
          `return { ok: true, id: tagId, replaced }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(rules)}, ${JSON.stringify(id)})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { ok: true; id: string; replaced: boolean }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `inject-css failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'wait',
      {
        titleKey: 'mcpToolTitles.wait',
        title: 'Sleep',
        description:
          'Block for `ms` milliseconds. Use only when nothing else fits — prefer `wait-for` (DOM condition) ' +
          'or `refresh` (waits for `did-finish-load`). Capped at 30000 ms to prevent runaways.',
        inputSchema: {
          ms: z.coerce.number().int().min(1).max(30_000).describe('Milliseconds to wait. Max 30000.')
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const rawMs = typeof argRecord['ms'] === 'number' ? argRecord['ms'] : 0
        const ms = Math.max(1, Math.min(30_000, Math.floor(rawMs)))
        await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
        return { content: [{ type: 'text', text: JSON.stringify({ waited: ms }) }] }
      }
    )

    this.registerTool(
      'get-computed-style',
      {
        titleKey: 'mcpToolTitles.getComputedStyle',
        title: 'Read computed CSS',
        description:
          'Return `getComputedStyle` values for a CSS-selected element. Pass a `properties` array to filter — ' +
          'omit it to get the FULL computed style (long but exhaustive). Useful to verify a CSS rule actually applies, ' +
          'debug specificity / cascade issues, or read theme tokens (`--button-background`, etc.).',
        inputSchema: {
          selector: z.string().min(1).describe('CSS selector of the element to inspect.'),
          properties: jsonOrNative(z.array(z.string())).optional().describe(
            'Property names to read (e.g. `["color", "background-color", "--button-background"]`). ' +
            'Omit to return all computed properties. Accepts either an array or a JSON-stringified array.'
          ),
          pseudoElement: z.string().optional().describe('Pseudo-element to query (e.g. `"::before"`, `"::placeholder"`).'),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const selector = typeof argRecord['selector'] === 'string' ? argRecord['selector'] : ''
        const properties = Array.isArray(argRecord['properties']) ? argRecord['properties'].filter((p): p is string => typeof p === 'string') : null
        const pseudoElement = typeof argRecord['pseudoElement'] === 'string' ? argRecord['pseudoElement'] : null
        if (!selector) {
          return { content: [{ type: 'text', text: 'selector is required' }], isError: true }
        }
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        const code = `((sel, props, pseudo) => { try { ` +
          `const el = document.querySelector(sel); ` +
          `if (!el) return { error: 'No element matches selector: ' + sel }; ` +
          `const cs = window.getComputedStyle(el, pseudo || null); ` +
          `if (props && props.length) { ` +
            `const out = {}; for (const p of props) out[p] = cs.getPropertyValue(p).trim(); ` +
            `return { selector: sel, pseudoElement: pseudo, properties: out }; ` +
          `} ` +
          `const all = {}; for (let i = 0; i < cs.length; i++) { const p = cs.item(i); all[p] = cs.getPropertyValue(p).trim(); } ` +
          `return { selector: sel, pseudoElement: pseudo, properties: all }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(selector)}, ${JSON.stringify(properties)}, ${JSON.stringify(pseudoElement)})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { selector: string; pseudoElement: string | null; properties: Record<string, string> }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `get-computed-style failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'get-windows',
      {
        titleKey: 'mcpToolTitles.getWindows',
        title: 'List BrowserWindows',
        description:
          'Return every active BrowserWindow with its `id` (= `webContents.id`), `title`, `bounds`, and ' +
          'focus / visible / minimized / maximized / fullscreen flags. Pair with the `windowId` argument ' +
          'accepted by every renderer-facing tool (`screenshot`, `dom-query`, `dispatch-event`, …) to ' +
          'target a specific window in multi-window setups (e.g. detached workbench tabs in their own windows).'
      },
      () => {
        const wins = BrowserWindow.getAllWindows()
          .filter((w) => !w.isDestroyed())
          .map((w) => {
            const b = w.getBounds()
            return {
              id: w.webContents.id,
              title: w.getTitle(),
              bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
              isFocused: w.isFocused(),
              isVisible: w.isVisible(),
              isMinimized: w.isMinimized(),
              isMaximized: w.isMaximized(),
              isFullScreen: w.isFullScreen(),
              isAlwaysOnTop: w.isAlwaysOnTop(),
              devToolsOpened: w.webContents.isDevToolsOpened()
            }
          })
        return {
          content: [{ type: 'text', text: JSON.stringify({ count: wins.length, windows: wins }, null, 2) }]
        }
      }
    )

    this.registerTool(
      'drag-drop',
      {
        titleKey: 'mcpToolTitles.dragDrop',
        title: 'Drag and drop',
        description:
          'Simulate an HTML5 drag-and-drop from a source element to a target element. Fires the full event ' +
          'sequence — `dragstart` on the source, then `dragenter` + `dragover` walked across `steps` intermediate ' +
          'positions between source and target (so apps that gate the drop indicator on a real movement path see it), ' +
          'then `sustainedHovers` extra `dragover` events at the final position, then `drop` on whatever the cursor ' +
          'point hit, then `dragend` on the source. Uses a fresh `DataTransfer`, so the source\'s own `dragstart` ' +
          'handler can register MIME data normally. ' +
          'Use to reorder workbench tabs, split editor groups (drop near a group edge), reorder tree nodes — anything ' +
          'wired through HTML5 drag-and-drop. ' +
          '`dropPosition` picks where on the target rect to release: `center`, `top`, `right`, `bottom`, `left` (default `center`). ' +
          'Verified working against editor-group split via this exact sequence.',
        inputSchema: {
          sourceSelector: z.string().min(1).describe('CSS selector for the element being dragged.'),
          targetSelector: z.string().min(1).describe('CSS selector for the drop target.'),
          dropPosition: z.enum(['center', 'top', 'right', 'bottom', 'left']).optional().describe(
            'Position within the target rect to drop on (default `center`). The actual drop is dispatched on ' +
            '`document.elementFromPoint(x, y)` for that position, so you may end up dropping on an overlay child.'
          ),
          steps: z.coerce.number().int().min(1).max(50).optional().describe(
            'Number of intermediate `dragenter`/`dragover` events along the path (default 10, max 50). ' +
            'More steps = smoother emulation, but rarely needed beyond 15.'
          ),
          sustainedHovers: z.coerce.number().int().min(0).max(20).optional().describe(
            'Number of additional `dragover` events fired at the final position before the `drop` (default 5). ' +
            'Apps that throttle/debounce their drop indicator may need a few hovers to settle.'
          ),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const argRecord = args
        const sourceSelector = typeof argRecord['sourceSelector'] === 'string' ? argRecord['sourceSelector'] : ''
        const targetSelector = typeof argRecord['targetSelector'] === 'string' ? argRecord['targetSelector'] : ''
        const dropPosition = typeof argRecord['dropPosition'] === 'string' ? argRecord['dropPosition'] : 'center'
        const steps = Math.max(1, Math.min(50, Math.floor(typeof argRecord['steps'] === 'number' ? argRecord['steps'] : 10)))
        const sustainedHovers = Math.max(0, Math.min(20, Math.floor(typeof argRecord['sustainedHovers'] === 'number' ? argRecord['sustainedHovers'] : 5)))
        const windowId = typeof argRecord['windowId'] === 'number' ? argRecord['windowId'] : undefined
        if (!sourceSelector || !targetSelector) {
          return { content: [{ type: 'text', text: 'sourceSelector and targetSelector are required' }], isError: true }
        }
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)
        // The whole drag sequence runs in the renderer. Shared
        // `DataTransfer` across the events lets the app's `dragstart`
        // handler stamp data that subsequent stages read back.
        const code = `(async (srcSel, tgtSel, pos, steps, hovers) => { try { ` +
          `const src = document.querySelector(srcSel); ` +
          `if (!src) return { error: 'No element matches sourceSelector: ' + srcSel }; ` +
          `const tgt = document.querySelector(tgtSel); ` +
          `if (!tgt) return { error: 'No element matches targetSelector: ' + tgtSel }; ` +
          `const sR = src.getBoundingClientRect(); ` +
          `const tR = tgt.getBoundingClientRect(); ` +
          `const dropX = pos === 'left' ? tR.x + 5 : pos === 'right' ? tR.x + tR.width - 5 : tR.x + tR.width / 2; ` +
          `const dropY = pos === 'top' ? tR.y + 5 : pos === 'bottom' ? tR.y + tR.height - 5 : tR.y + tR.height / 2; ` +
          `const startX = sR.x + sR.width / 2, startY = sR.y + sR.height / 2; ` +
          `const dt = new DataTransfer(); ` +
          `src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: startX, clientY: startY })); ` +
          `const path = []; ` +
          `for (let i = 1; i <= steps; i++) { ` +
            `const t = i / steps; ` +
            `const x = startX + (dropX - startX) * t; ` +
            `const y = startY + (dropY - startY) * t; ` +
            `const node = document.elementFromPoint(x, y); ` +
            `if (node) { ` +
              `node.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y })); ` +
              `node.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y })); ` +
              `path.push(node.tagName); ` +
            `} ` +
          `} ` +
          `for (let i = 0; i < hovers; i++) { ` +
            `const node = document.elementFromPoint(dropX, dropY); ` +
            `if (node) node.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dropX, clientY: dropY })); ` +
          `} ` +
          `const dropTarget = document.elementFromPoint(dropX, dropY); ` +
          `if (dropTarget) dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: dropX, clientY: dropY })); ` +
          `src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt })); ` +
          `return { ok: true, dropPoint: { x: Math.round(dropX), y: Math.round(dropY) }, dropTargetTag: dropTarget && dropTarget.tagName, dataTypes: Array.from(dt.types), pathSteps: path.length }; ` +
          `} catch (e) { return { error: String((e && e.message) || e) }; } ` +
          `})(${JSON.stringify(sourceSelector)}, ${JSON.stringify(targetSelector)}, ${JSON.stringify(dropPosition)}, ${steps}, ${sustainedHovers})`

        const result = (await win.webContents.executeJavaScript(code, true)) as
          | { error: string }
          | { ok: true; dropPoint: { x: number; y: number }; dropTargetTag: string | null; dataTypes: string[]; pathSteps: number }
        if ('error' in result) {
          return { content: [{ type: 'text', text: `drag-drop failed: ${result.error}` }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
    )

    this.registerTool(
      'mouse-input',
      {
        titleKey: 'mcpToolTitles.mouseInput',
        title: 'Trusted mouse input',
        description:
          'Inject OS-level, *trusted* (`isTrusted=true`) mouse input via `webContents.sendInputEvent` — the ' +
          'mouse counterpart of `keyboard-shortcut`. Use it for interactions that ignore synthetic DOM events: ' +
          'pointer-capture drags (React Flow link/connection drags), hover-opened submenus (ECUI ContextMenu, ' +
          'native-style menus), and Monaco wheel scrolling. The point comes from a `selector` (its rect centre) ' +
          'or explicit `x`/`y` (CSS px, viewport-relative). Gestures: `move` (hover), `click` (down+up), ' +
          '`drag` (down at start → moved across `steps` to the target → up), `wheel` (scroll by `deltaY`). ' +
          'For `drag`, give the target with `toSelector` or `toX`/`toY`. Prefer this over `dispatch-event` / ' +
          '`drag-drop` whenever the target ignores synthetic events.',
        inputSchema: {
          gesture: z.enum(['move', 'click', 'drag', 'wheel']).describe('move = hover; click = down+up; drag = down→move→up; wheel = scroll.'),
          selector: z.string().optional().describe('CSS selector; its rect centre is the (start) point. Provide this or x/y.'),
          x: z.coerce.number().optional().describe('Explicit (start) X in CSS px, viewport-relative. Used instead of selector.'),
          y: z.coerce.number().optional().describe('Explicit (start) Y in CSS px, viewport-relative. Used instead of selector.'),
          toSelector: z.string().optional().describe('drag only: target CSS selector (rect centre).'),
          toX: z.coerce.number().optional().describe('drag only: target X (CSS px).'),
          toY: z.coerce.number().optional().describe('drag only: target Y (CSS px).'),
          steps: z.coerce.number().int().min(1).max(60).optional().describe('drag only: intermediate moves along the path (default 16).'),
          button: z.enum(['left', 'middle', 'right']).optional().describe('Mouse button (default left).'),
          deltaX: z.coerce.number().optional().describe('wheel only: horizontal scroll delta.'),
          deltaY: z.coerce.number().optional().describe('wheel only: vertical scroll delta (negative = scroll up).'),
          windowId: windowIdSchema
        } as Record<string, unknown>
      },
      async (args) => {
        const a = args
        const gesture = typeof a['gesture'] === 'string' ? a['gesture'] : ''
        const button = (typeof a['button'] === 'string' ? a['button'] : 'left') as 'left' | 'middle' | 'right'
        const windowId = typeof a['windowId'] === 'number' ? a['windowId'] : undefined
        const win = pickWindow(windowId)
        if (!win) return noWindowError(windowId)

        // Resolve a point from explicit coords, else a selector's rect centre.
        const resolvePoint = async (sel: unknown, ex: unknown, ey: unknown): Promise<{ x: number; y: number } | { error: string }> => {
          if (typeof ex === 'number' && typeof ey === 'number') return { x: ex, y: ey }
          if (typeof sel === 'string' && sel) {
            const code = `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return { error: 'no element matches: ' + ${JSON.stringify(sel)} }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
            return (await win.webContents.executeJavaScript(code, true)) as { x: number; y: number } | { error: string }
          }
          return { error: 'provide a selector or explicit x/y' }
        }

        type InputEvt = Parameters<typeof win.webContents.sendInputEvent>[0]
        const send = (e: Record<string, unknown>): void => { win.webContents.sendInputEvent(e as unknown as InputEvt) }
        const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

        const start = await resolvePoint(a['selector'], a['x'], a['y'])
        if ('error' in start) return { content: [{ type: 'text', text: `mouse-input failed: ${start.error}` }], isError: true }
        const sx = Math.round(start.x)
        const sy = Math.round(start.y)

        if (gesture === 'wheel') {
          const deltaX = typeof a['deltaX'] === 'number' ? a['deltaX'] : 0
          const deltaY = typeof a['deltaY'] === 'number' ? a['deltaY'] : 0
          send({ type: 'mouseMove', x: sx, y: sy })
          send({ type: 'mouseWheel', x: sx, y: sy, deltaX, deltaY, canScroll: true })
          return { content: [{ type: 'text', text: JSON.stringify({ gesture, x: sx, y: sy, deltaX, deltaY }, null, 2) }] }
        }

        if (gesture === 'move') {
          send({ type: 'mouseMove', x: sx, y: sy })
          return { content: [{ type: 'text', text: JSON.stringify({ gesture, x: sx, y: sy }, null, 2) }] }
        }

        if (gesture === 'click') {
          send({ type: 'mouseMove', x: sx, y: sy })
          send({ type: 'mouseDown', x: sx, y: sy, button, clickCount: 1 })
          send({ type: 'mouseUp', x: sx, y: sy, button, clickCount: 1 })
          return { content: [{ type: 'text', text: JSON.stringify({ gesture, x: sx, y: sy, button }, null, 2) }] }
        }

        // drag: down at start → frame-paced moves → up at the target. The
        // delays let pointer-capture consumers (React Flow) process each move.
        const end = await resolvePoint(a['toSelector'], a['toX'], a['toY'])
        if ('error' in end) return { content: [{ type: 'text', text: `mouse-input drag target failed: ${end.error}` }], isError: true }
        const ex = Math.round(end.x)
        const ey = Math.round(end.y)
        const steps = Math.max(1, Math.min(60, Math.floor(typeof a['steps'] === 'number' ? a['steps'] : 16)))
        // The held button must be signalled on each move via the
        // `<button>ButtonDown` modifier — otherwise Chromium reports
        // `buttons: 0` on the pointermoves and a pointer-capture consumer
        // (React Flow's connection drag) sees the button as released and never
        // starts the drag.
        const heldModifier = `${button}ButtonDown`
        send({ type: 'mouseMove', x: sx, y: sy })
        send({ type: 'mouseDown', x: sx, y: sy, button, clickCount: 1 })
        await sleep(16)
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          send({ type: 'mouseMove', x: Math.round(sx + (ex - sx) * t), y: Math.round(sy + (ey - sy) * t), modifiers: [heldModifier] })
          await sleep(12)
        }
        send({ type: 'mouseUp', x: ex, y: ey, button, clickCount: 1 })
        return { content: [{ type: 'text', text: JSON.stringify({ gesture, from: { x: sx, y: sy }, to: { x: ex, y: ey }, steps, button }, null, 2) }] }
      }
    )

    this.registerTool(
      'batch',
      {
        titleKey: 'mcpToolTitles.batch',
        title: 'Chain MCP tool calls in one request',
        description:
          'Run a sequence of MCP tool calls in order, with an implicit "1 frame + 1 microtask" ' +
          'settle in the renderer between each step (override per step with `waitFor`, or skip ' +
          'globally via `skipImplicitSettle`). Aborts on the first step that throws or returns ' +
          '`isError: true`; subsequent steps are skipped. The response aggregates every step\'s ' +
          '`content` parts in order (so embedded images / resources reach the client inline) plus ' +
          'a final text part with the structured envelope `{ ranCount, totalCount, aborted, ' +
          'abortedAt, results }`. When a step is `screencast-stop`, the recorded `.webm` is read ' +
          'from disk and inlined as a `resource` content part so the caller gets the video bytes ' +
          'without a follow-up file read. Use to package `click → wait-for → screenshot` or ' +
          '`screencast-start → actions → screencast-stop` into one round-trip. Not to be confused ' +
          'with `run_request_batch`, which runs HTTP / protocol requests.',
        inputSchema: {
          steps: z.array(z.object({
            name: z.string().min(1).describe('Registered MCP tool name to invoke.'),
            args: z.record(z.string(), z.unknown()).optional().describe('Arguments forwarded to the tool. Defaults to `{}`.'),
            waitFor: z.object({
              ms: z.coerce.number().int().min(0).max(60_000).optional().describe('Fixed delay in ms.'),
              selector: z.string().optional().describe('CSS selector to wait for. Resolves once at least one match exists.'),
              predicate: z.string().optional().describe('JavaScript expression evaluated in the renderer. Resolves when it returns truthy.'),
              timeoutMs: z.coerce.number().int().min(50).max(60_000).optional().describe('Max wait when polling `selector` / `predicate`. Default 5000.'),
              pollMs: z.coerce.number().int().min(20).max(2000).optional().describe('Poll interval when watching `selector` / `predicate`. Default 100.')
            }).optional().describe(
              'Overrides the implicit "1 frame + 1 microtask" settle after this step. Pick one ' +
              'shape: `ms` for a fixed delay, `selector` to wait for an element to be present, or ' +
              '`predicate` for a JS expression evaluated in the renderer.'
            )
          })).min(1).describe('Ordered list of steps. Must contain at least one entry.'),
          windowId: windowIdSchema,
          skipImplicitSettle: z.coerce.boolean().optional().describe(
            'Skip the implicit "1 frame + 1 microtask" wait between steps. Default false. Steps ' +
            'with their own `waitFor` always use the override regardless of this flag.'
          )
        } as Record<string, unknown>
      },
      async (args) => {
        const stepsRaw = args['steps']
        if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
          return { content: [{ type: 'text', text: 'steps must be a non-empty array' }], isError: true }
        }
        const windowId = typeof args['windowId'] === 'number' ? args['windowId'] : undefined
        const skipImplicitSettle = args['skipImplicitSettle'] === true

        interface Step { name: string; args?: Record<string, unknown>; waitFor?: Record<string, unknown> }
        const steps: Step[] = stepsRaw.map((s) => s as Step)

        const aggregatedContent: Record<string, unknown>[] = []
        const envelope: { index: number; name: string; ok: boolean; error?: string }[] = []
        let aborted = false
        let abortedAt: number | null = null

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]
          if (!step || typeof step.name !== 'string' || step.name.length === 0) {
            const rawName: unknown = step?.name
            envelope.push({ index: i, name: typeof rawName === 'string' ? rawName : '', ok: false, error: 'step.name must be a non-empty string' })
            aborted = true
            abortedAt = i
            break
          }

          let stepResult: unknown
          try {
            stepResult = await Promise.resolve(this.invokeTool(step.name, step.args ?? {}))
          } catch (err) {
            envelope.push({ index: i, name: step.name, ok: false, error: err instanceof Error ? err.message : String(err) })
            aborted = true
            abortedAt = i
            break
          }

          const r = (stepResult ?? {}) as Record<string, unknown>
          const isErr = r['isError'] === true
          const content = Array.isArray(r['content']) ? r['content'] as Record<string, unknown>[] : []

          if (isErr) {
            const firstText = content.find((c) => c['type'] === 'text')
            const errText = firstText && typeof firstText['text'] === 'string' ? firstText['text'] : `step ${i} (${step.name}) reported isError`
            envelope.push({ index: i, name: step.name, ok: false, error: errText })
            // include the error content so callers see what the tool said
            aggregatedContent.push(...content)
            aborted = true
            abortedAt = i
            break
          }

          envelope.push({ index: i, name: step.name, ok: true })
          aggregatedContent.push(...content)

          // Special case: screencast-stop returns a .webm on disk. Inline the
          // bytes as a `resource` content part so the caller doesn't need a
          // follow-up file read. Silent-skip on any parse / IO failure — the
          // path is still in the text part above.
          if (step.name === 'screencast-stop') {
            const textPart = content.find((c) => c['type'] === 'text')
            const textVal = textPart && typeof textPart['text'] === 'string' ? textPart['text'] : null
            if (textVal) {
              try {
                const parsed = JSON.parse(textVal) as { path?: unknown; mimeType?: unknown }
                if (typeof parsed.path === 'string' && parsed.path.length > 0) {
                  const blob = readFileSync(parsed.path).toString('base64')
                  aggregatedContent.push({
                    type: 'resource',
                    resource: {
                      uri: `file://${parsed.path}`,
                      mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : 'video/webm',
                      blob
                    }
                  })
                }
              } catch (err) {
                logger.warn('batch: failed to inline screencast .webm', { error: String(err) })
              }
            }
          }

          // Post-step settle.
          const waitFor = step.waitFor && typeof step.waitFor === 'object' ? step.waitFor : null
          if (waitFor) {
            try {
              await runStepWait(waitFor, windowId)
            } catch (err) {
              envelope.push({ index: i, name: `${step.name}#waitFor`, ok: false, error: err instanceof Error ? err.message : String(err) })
              aborted = true
              abortedAt = i
              break
            }
          } else if (!skipImplicitSettle) {
            await runImplicitSettle(windowId)
          }
        }

        aggregatedContent.push({
          type: 'text',
          text: JSON.stringify({
            ranCount: envelope.filter((e) => e.ok).length,
            totalCount: steps.length,
            aborted,
            abortedAt,
            results: envelope
          }, null, 2)
        })

        return aborted ? { content: aggregatedContent, isError: true } : { content: aggregatedContent }
      }
    )

    this.registerTool(
      'open_mini_browser',
      {
        titleKey: 'mcpToolTitles.openMiniBrowser',
        title: 'Open the Mini browser workbench tab',
        description:
          'Open (or focus, if already open) the singleton Mini browser tab in the active window. ' +
          'Optional `url` navigates the embedded webview to that address. The host renderer ' +
          'normalises bare hosts (e.g. `example.com`) the same way as user-typed addresses. ' +
          'Requires the host app to wire `useMcpMiniBrowserBridge` to the Mini browser IPC channels.',
        inputSchema: {
          url: z.string().min(1).optional().describe(
            'Optional URL to navigate to immediately. Accepts bare hosts (e.g. `example.com`).'
          )
        } as Record<string, unknown>
      },
      (args) => {
        const url = typeof args['url'] === 'string' ? args['url'] : null
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(MINI_BROWSER_OPEN_CHANNEL, url !== null ? { url } : {})
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ opened: true, ...(url !== null ? { url } : {}) }, null, 2) }]
        }
      }
    )

    this.registerTool(
      'mini_browser_execute',
      {
        titleKey: 'mcpToolTitles.miniBrowserExecute',
        title: 'Run a script inside the Mini browser guest',
        description:
          'Execute a JavaScript expression inside the Mini browser\'s `<webview>` guest context ' +
          '(NOT the host renderer) and return the result. Wraps Electron\'s ' +
          '`webview.executeJavaScript(code)`. Use it to fill login forms in the embedded site, ' +
          'extract a token from the page\'s `localStorage`, click a button, or read a DOM node. ' +
          'The result is whatever the expression resolves to (JSON-serialisable values come back ' +
          'as-is; functions and circular refs become `null`). Returns an error if no Mini browser ' +
          'tab is open or the webview hasn\'t finished its initial load.',
        inputSchema: {
          code: z.string().min(1).describe('JavaScript expression to evaluate in the guest context. Wrap multi-statement code in an IIFE.'),
          timeoutMs: z.coerce.number().int().min(500).max(60_000).optional().describe('Max time to wait for the renderer to forward the result. Default 5000ms.')
        } as Record<string, unknown>
      },
      async (args) => {
        const code = typeof args['code'] === 'string' ? args['code'] : ''
        if (!code) return { content: [{ type: 'text', text: 'code is required' }], isError: true }
        // Clamp here too: when `batch` calls this via `invokeTool`, the
        // SDK's Zod validation is bypassed, so a bad `timeoutMs` (0,
        // negative, huge) would otherwise reach `executeInMiniBrowser`.
        const rawTimeout = typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : 5_000
        const timeoutMs = Math.max(500, Math.min(60_000, Math.floor(rawTimeout)))
        const outcome = await executeInMiniBrowser(code, timeoutMs)
        if (outcome.ok) {
          return { content: [{ type: 'text', text: JSON.stringify({ result: outcome.result }, null, 2) }] }
        }
        return { content: [{ type: 'text', text: outcome.error }], isError: true }
      }
    )

    this.registerTool(
      'open_console',
      {
        titleKey: 'mcpToolTitles.openConsole',
        title: 'Open the Console workbench tab',
        description:
          'Open (or focus, if already open) the host app\'s Console panel. The Console shows the ' +
          'audit feed of intercepted outbound requests, formatted as curl / powershell. Broadcasts ' +
          'CONSOLE_OPEN_CHANNEL — requires the host to render `ConsolePanel` and wire its tab.',
        inputSchema: {} as Record<string, unknown>
      },
      () => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(CONSOLE_OPEN_CHANNEL, {})
        }
        return { content: [{ type: 'text', text: JSON.stringify({ opened: true }, null, 2) }] }
      }
    )

    this.registerTool(
      'console_clear',
      {
        titleKey: 'mcpToolTitles.consoleClear',
        title: 'Clear the Console panel',
        description:
          'Wipe the renderer-side Console feed buffer. Same effect as clicking the toolbar ' +
          '"Clear" button. Broadcasts CONSOLE_CLEAR_CHANNEL — the host wires it to ' +
          '`clearConsoleFeed()`. Useful to reset the log before a focused experiment.',
        inputSchema: {} as Record<string, unknown>
      },
      () => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(CONSOLE_CLEAR_CHANNEL, {})
        }
        return { content: [{ type: 'text', text: JSON.stringify({ cleared: true }, null, 2) }] }
      }
    )

    this.registerTool(
      'set_tab_maximized',
      {
        titleKey: 'mcpToolTitles.setTabMaximized',
        title: 'Maximize or restore a workbench tab',
        description:
          'Open a workbench tab fullscreen (in the same modal a double-click on the tab opens), ' +
          'or restore it back to its normal split-pane slot. The maximized and normal views share ' +
          'one React instance, so no edits / responses / scroll state are lost in either direction. ' +
          'Pass `maximized: true` with a `tabId` to maximize; pass `maximized: false` to restore ' +
          '(the `tabId` is ignored on restore — at most one tab can be maximized at a time). ' +
          'Only tabs the host marked maximizable (`allowFullscreen`) will actually maximize. ' +
          'Broadcasts SET_TAB_MAXIMIZED_CHANNEL — requires the host to wire `EditorWorkbench`\'s ' +
          '`setFullscreenTabId` handle to it.',
        inputSchema: {
          tabId: z.string().min(1).optional().describe('Id of the tab to maximize. Required when `maximized` is true; ignored when false.'),
          maximized: z.coerce.boolean().describe('true to maximize the tab, false to restore the currently-maximized tab.')
        } as Record<string, unknown>
      },
      (args) => {
        // `batch` / `invokeTool` bypass the SDK's Zod validation, so
        // re-check the contract here rather than trusting `args`.
        const maximized = args['maximized'] === true || args['maximized'] === 'true'
        const tabId = typeof args['tabId'] === 'string' && args['tabId'].length > 0 ? args['tabId'] : null
        if (maximized && tabId === null) {
          return { content: [{ type: 'text', text: 'tabId is required when maximized is true' }], isError: true }
        }
        const payload = { tabId: maximized ? tabId : null, maximized }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(SET_TAB_MAXIMIZED_CHANNEL, payload)
        }
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
      }
    )
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Defence in depth: even though we listen on 127.0.0.1, a
    // misconfigured proxy or future binding change shouldn't open
    // tools to non-loopback callers. Reject anything else outright.
    const remote = req.socket.remoteAddress
    if (!isLoopbackAddress(remote)) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    // Bearer-token gate. Loopback alone doesn't protect against other
    // local processes or browser-tab CSRF — the token cuts both off.
    // Constant-time compare avoids leaking info via response timing.
    const expectedToken = this.options.authToken
    if (expectedToken !== undefined && expectedToken.length > 0) {
      const provided = extractBearerToken(req.headers.authorization)
      if (provided === null || !timingSafeStringEq(provided, expectedToken)) {
        res.statusCode = 401
        res.setHeader('WWW-Authenticate', 'Bearer')
        res.end('Unauthorized')
        return
      }
    }

    // Notify subscribers (UI activity indicators, etc.) BEFORE the
    // JSON-RPC handler so listeners see every request — including
    // those that error out below. No payload; the event is opaque.
    this.notifyRequestListeners()

    // Cross-instance routing bridge. Only kicks in when this instance
    // was given a `sessionName` AND a `discoveryDir`. We buffer the
    // body once so we can (a) read the reserved `__session` routing key
    // off a `tools/call`, (b) strip it before the SDK ever validates the
    // tool's args, and (c) forward the original JSON-RPC verbatim to a
    // named peer. Without both options set, the body stream is left
    // untouched and handed straight to the SDK below (zero overhead for
    // consumers that never opted in).
    let bodyForSdk: Buffer | null = null
    if (this.options.sessionName !== undefined && this.options.discoveryDir) {
      let raw: Buffer
      try {
        raw = await readRequestBody(req)
      } catch (err) {
        logger.error('McpService failed to read request body for routing', { error: String(err) })
        res.statusCode = 400
        res.end('Bad Request')
        return
      }
      const routed = await this.maybeRouteRequest(raw, req, res)
      if (routed.handled) return
      // Either no routing key, or it named us: dispatch the (possibly
      // key-stripped) body locally by replaying it to the SDK. A forwarded
      // (passthrough) call returned `handled: true` above, so we only ever
      // reach here for a LOCAL dispatch — record it for the logs viewer.
      bodyForSdk = routed.localBody
      this.recordServedCallFromBuffer(bodyForSdk)
    } else if (this.servedCallCap > 0 && req.method === 'POST') {
      // No routing bridge, but served-call retention is on: a `tools/call`
      // arrives as an HTTP POST, so buffer ONLY POST bodies to read the
      // payload, then replay them to the SDK. GET/DELETE (the transport's
      // SSE / session-close verbs) carry no body and are left untouched —
      // replaying an empty body would break their streams.
      try {
        bodyForSdk = await readRequestBody(req)
      } catch (err) {
        logger.error('McpService failed to read request body for logs', { error: String(err) })
        res.statusCode = 400
        res.end('Bad Request')
        return
      }
      this.recordServedCallFromBuffer(bodyForSdk)
    }

    // Wrap the per-request server lifecycle in an
    // `AsyncLocalStorage.run` so any `dialog.show*` call made by a
    // tool handler (transitively, even deep through the consuming
    // app's main-process services) flows the bypass marker through
    // the async chain. User-driven dialogs run outside this `run`
    // and keep the real native modal.
    await mcpToolContext.run({ toolName: 'mcp-request' }, async () => {
      let server: McpServer | null = null
      let transport: StreamableHTTPServerTransport | null = null
      try {
        const serverInfo = this.options.serverInfo ?? { name: 'electron-core-ui-mcp', version: '0.1.0' }
        // `instructions` rides the `initialize` response so a fresh client
        // (e.g. an AI agent) gets its orientation up front.
        server = this.options.instructions
          ? new McpServer(serverInfo, { instructions: this.options.instructions })
          : new McpServer(serverInfo)
        for (const tool of this.tools) {
          // Cast through `unknown` — the SDK's overloads union expects
          // very specific shapes per overload; we already validate the
          // surface via `McpToolConfig` / `McpToolHandler`.
          type SdkRegisterTool = (
            name: string,
            config: unknown,
            handler: unknown
          ) => unknown
          // Wrap the handler so the local tool RESULT is captured into the
          // served-call log: `recordServedCall` recorded the request just above,
          // so the latest buffer entry IS this call (same assumption as the
          // capture tools). Forwarded calls never reach here — the bridge
          // answered them — matching `recordServedCall`'s local-only scope.
          const baseHandler = tool.handler as (a: unknown, e: unknown) => unknown
          const loggedHandler = (a: unknown, e: unknown): unknown => {
            const out: unknown = baseHandler(a, e)
            if (out instanceof Promise) {
              return (out as Promise<unknown>).then((r: unknown): unknown => {
                this.attachResponseToLatest(r)
                return r
              })
            }
            this.attachResponseToLatest(out)
            return out
          }
          ;(server.registerTool.bind(server) as SdkRegisterTool)(tool.name, tool.config, loggedHandler)
        }
        for (const resource of this.resources) {
          // Static URI vs templated URI: the SDK has different overloads
          // for each. Templated URIs contain `{var}` placeholders; we
          // route them through `ResourceTemplate` so the SDK does the
          // matching. The handler receives the parsed `URL` either way
          // and can pull variables from `uri.pathname` itself.
          type SdkRegisterResource = (
            name: string,
            uriOrTemplate: string | ResourceTemplate,
            config: unknown,
            handler: unknown
          ) => unknown
          const isTemplated = resource.uri.includes('{')
          const target = isTemplated
            ? new ResourceTemplate(resource.uri, { list: undefined })
            : resource.uri
          const wrapped = (uri: URL): unknown => {
            const result = resource.handler(uri)
            const finalize = (
              r: { text?: string; blob?: string; mimeType?: string }
            ): unknown => {
              const mimeType = r.mimeType ?? resource.config.mimeType ?? (r.text !== undefined ? 'application/json' : undefined)
              if (r.blob !== undefined) {
                return { contents: [{ uri: uri.toString(), mimeType, blob: r.blob }] }
              }
              return { contents: [{ uri: uri.toString(), mimeType, text: r.text ?? '' }] }
            }
            return result instanceof Promise ? result.then(finalize) : finalize(result)
          }
          ;(server.registerResource.bind(server) as SdkRegisterResource)(
            resource.name,
            target,
            { title: resource.config.title, description: resource.config.description, mimeType: resource.config.mimeType },
            wrapped
          )
        }
        transport = new StreamableHTTPServerTransport(
          // Stateless: omitting `sessionIdGenerator` makes each
          // request stand alone. The cast strips
          // `exactOptionalPropertyTypes` friction with the SDK's
          // optional field.
          {} as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]
        )
        await server.connect(transport as unknown as Parameters<typeof server.connect>[0])
        // Normally pass `req` through untouched — the SDK (via Hono's
        // `getRequestListener`) converts `IncomingMessage` to a Web
        // Standard `Request` itself and needs the body stream intact.
        //
        // When the routing bridge already drained the body (to peel the
        // `__session` key), the original stream is exhausted. We then (a)
        // replay the buffered bytes through a synthetic readable so Hono
        // can still build the web `Request`, and (b) hand the parsed
        // payload to `handleRequest` as `parsedBody` so the SDK uses it
        // directly instead of re-reading the stream.
        if (bodyForSdk !== null) {
          const sdkReq = replayRequest(req, bodyForSdk)
          const parsed: unknown = JSON.parse(bodyForSdk.toString('utf8'))
          await transport.handleRequest(sdkReq, res, parsed)
        } else {
          await transport.handleRequest(req, res)
        }
      } catch (err) {
        logger.error('McpService request failed', { error: String(err) })
        if (!res.headersSent) {
          res.statusCode = 500
          res.end('Internal Server Error')
        }
      } finally {
        // Tear down the per-request pair so resources aren't held
        // beyond the response's lifetime.
        if (transport) await transport.close().catch(() => undefined)
        if (server) await server.close().catch(() => undefined)
      }
    })
  }

  /**
   * Inspect a buffered request body for the reserved `__session` routing
   * key and decide how to dispatch it. Returns either:
   *
   *   - `{ handled: true }` — the request was fully answered here (it
   *     was forwarded to a named peer and the response relayed, or the
   *     target couldn't be resolved and a JSON-RPC error was written).
   *   - `{ handled: false, localBody }` — run it locally; `localBody` is
   *     the body with the routing key stripped (or the untouched body
   *     when there was no key / it named us).
   *
   * Only ever called when `sessionName` + `discoveryDir` are set.
   */
  private async maybeRouteRequest(
    raw: Buffer,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<{ handled: true } | { handled: false; localBody: Buffer }> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      // Not JSON we can route (or empty) — hand the original body to the
      // SDK, which will produce its own parse error if appropriate.
      return { handled: false, localBody: raw }
    }

    // Only `tools/call` carries per-tool `arguments`; every other method
    // (initialize, tools/list, notifications/…) has no routing key.
    const msg = parsed as { method?: unknown; id?: unknown; params?: { arguments?: unknown } }
    const args = msg.params?.arguments
    if (msg.method !== 'tools/call' || typeof args !== 'object' || args === null) {
      return { handled: false, localBody: raw }
    }

    const argRecord = args as Record<string, unknown>
    if (!(MCP_SESSION_ROUTING_KEY in argRecord)) {
      return { handled: false, localBody: raw }
    }

    const targetRaw = argRecord[MCP_SESSION_ROUTING_KEY]
    const target = typeof targetRaw === 'string' ? targetRaw.trim() : ''

    // Strip the routing key in all cases so individual tools never see
    // it (their Zod schemas are strict and would reject the unknown key).
    const { [MCP_SESSION_ROUTING_KEY]: _routingKey, ...strippedArgs } = argRecord
    void _routingKey
    const localBody = Buffer.from(
      JSON.stringify({ ...(parsed as Record<string, unknown>), params: { ...msg.params, arguments: strippedArgs } }),
      'utf8'
    )

    // Empty / own name → run locally with the key removed.
    if (target === '' || target === this.options.sessionName) {
      return { handled: false, localBody }
    }

    // Loop guard: a request that already crossed one bridge hop must not
    // forward again, even if its `__session` somehow still names a peer.
    // Run it locally (key stripped) instead of bouncing it onward.
    const alreadyForwarded = req.headers[MCP_FORWARDED_HEADER] !== undefined
    if (alreadyForwarded) {
      logger.warn('McpService refusing to re-forward an already-forwarded request', { target })
      return { handled: false, localBody }
    }

    // Names another instance → forward verbatim (with the key still IN,
    // so the destination strips it itself). Discovery + transport + the
    // timeout/error bounding all live in ./mcpDiscovery; a missing dir
    // would have skipped this whole block (guarded at the call site).
    const id = msg.id ?? null
    let result: { status: number; body: string; contentType?: string } | null
    try {
      result = this.options.discoveryDir
        ? await forwardToNamedSession(this.options.discoveryDir, target, raw.toString('utf8'))
        : null
    } catch (err) {
      logger.error('McpService cross-instance forward threw', { target, error: String(err) })
      result = null
    }

    if (result === null) {
      writeJsonRpcError(res, id, -32001, `No live MCP session named "${target}" is reachable.`)
      return { handled: true }
    }

    // Relay the peer's HTTP response verbatim: same status + same
    // `Content-Type` + same body, so the caller's transport parses it
    // exactly as if it had talked to the peer directly. Fall back to a
    // status-derived guess only if the peer didn't report a content type.
    res.statusCode = result.status
    res.setHeader(
      'Content-Type',
      result.contentType ?? (result.status >= 200 && result.status < 300 ? 'text/event-stream' : 'application/json')
    )
    res.end(result.body)
    return { handled: true }
  }

}

function parseConsoleMessage(args: unknown[], windowId: number): ConsoleLogEntry {
  // Newer Electron emits a single event object with named fields.
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    const ev = args[0] as Record<string, unknown>
    return {
      timestamp: Date.now(),
      level: typeof ev['level'] === 'string' ? ev['level'] : (typeof ev['level'] === 'number' ? String(ev['level']) : 'info'),
      message: typeof ev['message'] === 'string' ? ev['message'] : '',
      source: typeof ev['sourceId'] === 'string' ? ev['sourceId'] : (typeof ev['source'] === 'string' ? ev['source'] : ''),
      line: typeof ev['lineNumber'] === 'number' ? ev['lineNumber'] : (typeof ev['line'] === 'number' ? ev['line'] : 0),
      windowId
    }
  }
  // Older positional signature: `(event, level, message, line, sourceId)`.
  // Map numeric levels (0=verbose, 1=info, 2=warning, 3=error) to strings.
  const level = args[1]
  const levelStr = typeof level === 'string'
    ? level
    : (typeof level === 'number'
      ? (['verbose', 'info', 'warning', 'error'][level] ?? 'info')
      : 'info')
  return {
    timestamp: Date.now(),
    level: levelStr,
    message: typeof args[2] === 'string' ? args[2] : '',
    source: typeof args[4] === 'string' ? args[4] : '',
    line: typeof args[3] === 'number' ? args[3] : 0,
    windowId
  }
}

function pickActiveWindow(): BrowserWindow | null {
  // Prefer the focused window (matches user attention). Fall back to
  // any visible non-destroyed window — Linux occasionally drops
  // focus to "no window" without a corresponding `blur` event,
  // leaving `getFocusedWindow()` returning `null`.
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.isVisible()) return w
  }
  return null
}

/**
 * Tool-side window picker: when `windowId` is provided, find the
 * `BrowserWindow` whose `webContents.id` matches; when omitted, fall
 * back to the focused / first-visible heuristic. Lets multi-window
 * consumers target a specific renderer per call (paired with the
 * `get-windows` tool that exposes the live id list).
 */
function pickWindow(windowId: number | undefined): BrowserWindow | null {
  if (typeof windowId === 'number') {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w.webContents.id === windowId) return w
    }
    return null
  }
  return pickActiveWindow()
}

/**
 * Standard "no window" tool result, shared by every renderer-facing
 * tool. The error message is more helpful when an explicit `windowId`
 * was given but didn't match any live BrowserWindow.
 */
function noWindowError(windowId: number | undefined): { content: { type: 'text'; text: string }[]; isError: true } {
  return {
    content: [{
      type: 'text',
      text: typeof windowId === 'number'
        ? `No BrowserWindow with webContents.id ${String(windowId)} — call get-windows to list available ids.`
        : 'No BrowserWindow available'
    }],
    isError: true
  }
}

/**
 * Reusable Zod schema for the optional `windowId` argument every
 * renderer-facing tool accepts. Keeps the description consistent.
 */
const windowIdSchema = z.coerce.number().int().optional().describe(
  'Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit to use the focused / first-visible window.'
)

/**
 * Wraps a Zod schema so it accepts either the native shape OR a
 * JSON-serialised string of the same shape. Some MCP clients
 * stringify complex parameters (objects, arrays) before sending —
 * this lets the tool accept both forms transparently.
 */
function jsonOrNative<T extends z.ZodType>(inner: T): z.ZodType<z.infer<T>> {
  return z.preprocess((val) => {
    if (typeof val !== 'string') return val
    try { return JSON.parse(val) as unknown } catch { return val }
  }, inner) as z.ZodType<z.infer<T>>
}

/**
 * Drain an `IncomingMessage` body into a single Buffer. Used by the
 * cross-instance routing bridge so it can peek at the `__session` key
 * before the SDK consumes the stream. Bounded so a runaway body can't
 * exhaust memory — the JSON-RPC payloads we route are small.
 */
function readRequestBody(req: IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        req.destroy()
        reject(new Error('request body exceeds limit'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

/**
 * Build a synthetic `IncomingMessage` that replays `body` while carrying
 * the original request's method / url / headers (with a corrected
 * `content-length`). Needed because the routing bridge drains the real
 * stream to inspect it, leaving it exhausted — the SDK transport (via
 * `@hono/node-server`'s `getRequestListener`) still builds a web
 * `Request` from this object downstream.
 *
 * Hono reads `rawHeaders` (NOT just `headers`) and, when present, a
 * `rawBody` Buffer — so we set both: `rawBody` is the path Hono actually
 * takes (it prefers a `rawBody` Buffer over reading the stream), and
 * `rawHeaders` is the array form Hono iterates pairwise. The `Readable`
 * base only exists to satisfy the `IncomingMessage` type + the
 * remote-address re-check; it is not the body source on this path.
 */
function replayRequest(original: IncomingMessage, body: Buffer): IncomingMessage {
  const replay = Readable.from([body]) as unknown as IncomingMessage & { rawBody?: Buffer }
  const headers = { ...original.headers, 'content-length': String(body.length) }
  replay.headers = headers
  // Hono iterates `rawHeaders` as a flat [key, value, key, value, …]
  // array. Rebuild it from the (corrected) headers map so the lengths
  // stay consistent with `content-length`.
  const rawHeaders: string[] = []
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) for (const item of v) rawHeaders.push(k, item)
    else if (v !== undefined) rawHeaders.push(k, v)
  }
  replay.rawHeaders = rawHeaders
  replay.rawBody = body
  replay.method = original.method
  replay.url = original.url
  replay.httpVersion = original.httpVersion
  // Preserve the socket so any downstream remote-address / loopback
  // re-check still sees the real peer.
  ;(replay as { socket?: unknown }).socket = original.socket
  return replay
}

/** Write a JSON-RPC error response on the raw HTTP socket. */
function writeJsonRpcError(res: ServerResponse, id: unknown, code: number, message: string): void {
  if (res.headersSent) return
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }))
}

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false
  // Cover IPv4 loopback, IPv6 loopback, and the IPv4-mapped IPv6 form
  // Node hands out when listening on a dual-stack socket.
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

/**
 * Pull the bearer token out of an `Authorization` header value. Returns
 * `null` for missing / malformed headers; the caller treats `null` as
 * "no credentials" and rejects with 401. The header value is whatever
 * Node parsed — for repeated `Authorization` headers it'd be an array,
 * which we treat as malformed (single canonical credential expected).
 */
function extractBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return null
  const captured = match[1]
  return captured === undefined ? null : captured.trim()
}

/**
 * Constant-time string equality. The length check short-circuits before
 * `timingSafeEqual` (which throws on mismatched lengths) — that's safe
 * because the token length is fixed by the caller, so length doesn't
 * leak useful information.
 */
function timingSafeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Round-trip executor for the `mini_browser_execute` tool: broadcast a
 * request with a unique id to every renderer window, wait for the first
 * matching reply on the `-reply` channel, then resolve. Times out
 * cleanly so an agent doesn't hang on a window with no webview mounted.
 */
function executeInMiniBrowser(
  code: string,
  timeoutMs: number
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return new Promise((resolve) => {
    let settled = false
    const handler = (_e: unknown, payload: unknown): void => {
      if (settled) return
      const p = payload as { requestId?: string; result?: unknown; error?: string }
      if (p.requestId !== requestId) return
      settled = true
      ipcMain.off(MINI_BROWSER_EXECUTE_REPLY_CHANNEL, handler)
      if (typeof p.error === 'string' && p.error.length > 0) {
        resolve({ ok: false, error: p.error })
      } else {
        resolve({ ok: true, result: p.result })
      }
    }
    ipcMain.on(MINI_BROWSER_EXECUTE_REPLY_CHANNEL, handler)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(MINI_BROWSER_EXECUTE_CHANNEL, { requestId, code })
    }
    setTimeout(() => {
      if (settled) return
      settled = true
      ipcMain.off(MINI_BROWSER_EXECUTE_REPLY_CHANNEL, handler)
      resolve({ ok: false, error: `mini_browser_execute: no renderer reply within ${timeoutMs}ms — is the Mini browser tab open?` })
    }, timeoutMs)
  })
}

/**
 * One frame of paint + one microtask flush in the target renderer. Used
 * by the `batch` tool between steps so the next call sees the DOM after
 * React has reconciled the previous step's effects. Silent no-op when
 * no window is available (main-process-only tool chains still benefit
 * from the awaitable boundary).
 */
async function runImplicitSettle(windowId: number | undefined): Promise<void> {
  const win = pickWindow(windowId)
  if (!win || win.isDestroyed()) return
  try {
    await win.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(null), 0)))`,
      true
    )
  } catch {
    // Renderer torn down mid-batch — let the next step's executeJavaScript
    // surface the real error rather than masking it here.
  }
}

/**
 * Honours a step's explicit `waitFor`: a fixed `ms` delay, polling for a
 * `selector` to appear, or polling a JS `predicate` until truthy. Times
 * out after `timeoutMs` (default 5000) and throws so the batch reports
 * the failure.
 */
async function runStepWait(waitFor: Record<string, unknown>, windowId: number | undefined): Promise<void> {
  const ms = typeof waitFor['ms'] === 'number' ? waitFor['ms'] : null
  const selector = typeof waitFor['selector'] === 'string' ? waitFor['selector'] : null
  const predicate = typeof waitFor['predicate'] === 'string' ? waitFor['predicate'] : null
  const rawTimeout = typeof waitFor['timeoutMs'] === 'number' ? waitFor['timeoutMs'] : 5000
  const timeoutMs = Math.max(0, Math.min(60_000, Math.floor(rawTimeout)))
  const rawPoll = typeof waitFor['pollMs'] === 'number' ? waitFor['pollMs'] : 100
  const pollMs = Math.max(20, Math.min(2000, Math.floor(rawPoll)))

  if (ms !== null) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(60_000, Math.floor(ms)))))
    return
  }

  if (selector === null && predicate === null) {
    throw new Error('waitFor requires one of `ms`, `selector`, or `predicate`')
  }

  const win = pickWindow(windowId)
  if (!win || win.isDestroyed()) {
    throw new Error('waitFor needs a live BrowserWindow but none is available')
  }

  const code = selector !== null
    ? `(async (sel, timeoutMs, pollMs) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (document.querySelector(sel)) return { ok: true };
          await new Promise(r => setTimeout(r, pollMs));
        }
        return { ok: false, timedOut: true, mode: 'selector', selector: sel };
      })(${JSON.stringify(selector)}, ${timeoutMs}, ${pollMs})`
    : `(async (expr, timeoutMs, pollMs) => {
        const deadline = Date.now() + timeoutMs;
        const evaluate = new Function('return (' + expr + ')');
        while (Date.now() < deadline) {
          try { if (evaluate()) return { ok: true }; } catch (e) { return { ok: false, errored: true, message: String(e && e.message || e) }; }
          await new Promise(r => setTimeout(r, pollMs));
        }
        return { ok: false, timedOut: true, mode: 'predicate' };
      })(${JSON.stringify(predicate)}, ${timeoutMs}, ${pollMs})`

  const result = (await win.webContents.executeJavaScript(code, true)) as { ok: boolean; timedOut?: boolean; errored?: boolean; message?: string }
  if (!result.ok) {
    if (result.errored) throw new Error(`waitFor predicate threw: ${result.message ?? '?'}`)
    if (result.timedOut) throw new Error(`waitFor timed out after ${timeoutMs}ms`)
    throw new Error('waitFor failed')
  }
}
