import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { app, BrowserWindow, ipcMain, dialog as electronDialog } from 'electron'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { logger } from './LoggerService'
import {
  MINI_BROWSER_OPEN_CHANNEL,
  MINI_BROWSER_EXECUTE_CHANNEL,
  MINI_BROWSER_EXECUTE_REPLY_CHANNEL
} from '../../types/ipcChannels'

export interface McpServiceOptions {
  /**
   * Display name + version sent to MCP clients during the
   * `initialize` handshake. Defaults to a generic ECUI identity.
   */
  serverInfo?: { name: string; version: string }

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
   * Invoke a registered tool by name from inside the host process. The
   * built-in `batch` tool uses this to chain calls without going back
   * out through the HTTP transport. Throws if the tool is unknown.
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
        return {
          content: [{ type: 'image', data: base64, mimeType: 'image/png' }]
        }
      }
    )

    this.registerTool(
      'screencast-start',
      {
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
        const tmpPath = pathJoin(tmpdir(), `ecu-screencast-${Date.now()}.webm`)
        writeFileSync(tmpPath, buffer)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                path: tmpPath,
                byteLength: result.byteLength,
                durationMs: result.durationMs,
                mimeType: result.mimeType
              })
            }
          ]
        }
      }
    )

    this.registerTool(
      'refresh',
      {
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
      'batch',
      {
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
        const timeoutMs = typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : 5_000
        const outcome = await executeInMiniBrowser(code, timeoutMs)
        if (outcome.ok) {
          return { content: [{ type: 'text', text: JSON.stringify({ result: outcome.result }, null, 2) }] }
        }
        return { content: [{ type: 'text', text: outcome.error }], isError: true }
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
        server = new McpServer(serverInfo)
        for (const tool of this.tools) {
          // Cast through `unknown` — the SDK's overloads union expects
          // very specific shapes per overload; we already validate the
          // surface via `McpToolConfig` / `McpToolHandler`.
          type SdkRegisterTool = (
            name: string,
            config: unknown,
            handler: unknown
          ) => unknown
          ;(server.registerTool.bind(server) as SdkRegisterTool)(tool.name, tool.config, tool.handler)
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
        // Pass `req` through untouched — the SDK (via Hono's
        // `getRequestListener`) converts `IncomingMessage` to a Web
        // Standard `Request` itself and needs the body stream intact.
        await transport.handleRequest(req, res)
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
