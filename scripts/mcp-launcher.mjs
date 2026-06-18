#!/usr/bin/env node
/*
 * MCP launcher — sits between Claude Code (MCP client over stdio) and
 * restorm's embedded HTTP MCP server. Solves the chicken-and-egg
 * problem: when Claude Code starts, restorm may not be running yet,
 * AND we don't want to spawn restorm at session start if no MCP tool
 * is ever invoked. So:
 *
 *   - At startup we do NOT spawn restorm. We answer `initialize` and
 *     `tools/list` ourselves from a small built-in manifest, mirroring
 *     ECUI's `McpService` defaults. The Claude Code session starts
 *     fast and stays free of any GUI app launching unprompted.
 *   - On the first `tools/call` (or any other forwardable request), we
 *     probe `127.0.0.1:39000`. If nothing is listening, we detach
 *     `pnpm dev:restorm -- --mcp-port=39000`, wait until the port
 *     answers, then forward the call.
 *   - Whenever restorm transitions from unreachable → reachable
 *     (initial spawn OR a mid-session restart we detected via a
 *     connection error on a previous forward), we emit
 *     `notifications/tools/list_changed` after the response so
 *     Claude refreshes its cached tool list. Covers the case where
 *     the developer rebuilds restorm in another terminal and the
 *     new build registers extra tools.
 *   - Subsequent calls (no transition) forward straight through.
 *
 * The launcher does NOT own restorm's lifecycle — it spawns it
 * detached so the GUI app keeps running even after the launcher (and
 * Claude Code) exits. Subsequent sessions probe the port, find it up,
 * and skip the spawn.
 *
 * Run via Claude Code's `.mcp.json`:
 *
 *   { "mcpServers": { "restorm": {
 *       "command": "node",
 *       "args": ["scripts/mcp-launcher.mjs"]
 *   } } }
 */

import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { promises as fs, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const HOST = '127.0.0.1'
const SPAWN_WAIT_MS = 90_000
const PROBE_INTERVAL_MS = 250
// Short HTTP timeout when validating a discovered endpoint or GC'ing
// stale lockfiles. The endpoint is local, so a healthy restorm answers
// well under this; anything slower is treated as a stale carcass.
const HTTP_PROBE_TIMEOUT_MS = 800
const PROTOCOL_VERSION = '2025-03-26'

// Where running restorm instances drop their per-pid lockfile. Must match
// the discovery dir restorm resolves at startup — `resolveMcpDiscoveryDir`
// (from electron-core-ui) called in `restorm/src/main/index.ts` — the
// launcher and restorm rendezvous here, so the resolution MUST be
// identical on both sides.
//
// `RESTORM_MCP_DIR` pins it to a fixed, deterministic path. When an embedder
// (Claude Code / Cursor / Windsurf) launches restorm OUT OF BAND — i.e. not via
// our own `spawnRestormDetached`, which would share this process's env — the two
// sides otherwise resolve `os.tmpdir()` independently and can diverge (a shell
// that overrides `TMPDIR` writes the lockfile somewhere the launcher never
// looks). Setting the SAME `RESTORM_MCP_DIR` for both removes that race. Unset
// → the cross-platform, self-cleaning `os.tmpdir()` default (unchanged).
const DISCOVERY_DIR = process.env.RESTORM_MCP_DIR?.trim() || join(tmpdir(), 'restorm-mcp')

// Last `tools/list` restorm actually returned, persisted so the next session
// can answer `tools/list` (while restorm is still down) with the real, current
// tool set instead of the hand-written `BUILTIN_TOOLS` — which inevitably
// drifts as tools are added. Self-syncing: refreshed every time we forward a
// live `tools/list`. See `fallbackTools()` / `cacheTools()`.
//
// Deliberately a SIBLING of DISCOVERY_DIR, not a file inside it: that dir holds
// per-pid `*.json` lockfiles and the launcher GCs any `.json` there without a
// live pid — a cache file living inside would be swept on the next relaunch.
// Derived from DISCOVERY_DIR so it follows the same `RESTORM_MCP_DIR` override
// (default `/…/restorm-mcp` → `/…/restorm-mcp-tools-cache.json`, as before).
const TOOLS_CACHE_FILE = `${DISCOVERY_DIR}-tools-cache.json`

// Resolved at runtime — restorm picks a free OS port at boot and
// announces it via the lockfile. `null` means we haven't discovered
// (or spawned) a live instance yet.
let currentPort = null
// Bearer token restorm generated for this boot; the launcher injects
// `Authorization: Bearer <token>` on every forwarded HTTP request so
// the round-trip stays transparent for Claude Code / Cursor while the
// MCP endpoint stays gated against unauthenticated callers.
let currentToken = null

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Environment for an inactive (`--inactive-window`) restorm launch: a copy of
// ours with the desktop **activation tokens** stripped. On a native Wayland
// session a window cannot focus itself — the compositor only lets it when the
// app redeems an `xdg-activation` token, which a focused launcher hands down
// via `XDG_ACTIVATION_TOKEN` (its X11 startup-notification analogue is
// `DESKTOP_STARTUP_ID`). If the child inherits that token, Chromium's
// Ozone/Wayland backend redeems it and focuses the first window — defeating
// `showInactive()`. Not propagating the token leaves the compositor's
// focus-stealing-prevention in charge, so the window stays in the background.
// (ECUI also clears these in-process as a belt-and-suspenders; doing it here
// too means the child never even inherits them.)
function inactiveLaunchEnv() {
  const env = { ...process.env }
  delete env.XDG_ACTIVATION_TOKEN
  delete env.DESKTOP_STARTUP_ID
  return env
}

// stderr is the only safe place to log — stdout is the JSON-RPC
// channel Claude Code reads from.
function log(msg, extra) {
  const line = extra
    ? `[mcp-launcher] ${msg} ${JSON.stringify(extra)}`
    : `[mcp-launcher] ${msg}`
  process.stderr.write(line + '\n')
}

/**
 * Manifest mirrored from ECUI's `McpService.registerBuiltinTools`. Used
 * to answer `tools/list` while restorm is still down so Claude Code's
 * startup doesn't trigger a heavy spawn. When any tool is actually
 * called, restorm boots and sends `notifications/tools/list_changed`,
 * after which Claude refreshes from the real (live) endpoint.
 *
 * Keep in sync with `electron-core-ui/src/main/services/McpService.ts`.
 */
const BUILTIN_TOOLS = [
  {
    name: 'screenshot',
    title: 'Screenshot',
    description:
      'Capture the active Electron window as a PNG and return it base64-encoded. ' +
      'Use this to inspect the application UI state.',
    inputSchema: { type: 'object', properties: {
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      } }
  },
  {
    name: 'refresh',
    title: 'Refresh',
    description:
      "Reload the active Electron window's renderer. Equivalent to Ctrl+R / Cmd+R. " +
      'Useful to re-roll randomized UI (wallpapers, animations) or recover from a renderer-side ' +
      'error without restarting the app. Resolves once the page emits `did-finish-load`.',
    inputSchema: { type: 'object', properties: {
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      } }
  },
  {
    name: 'dom-query',
    title: 'Query DOM',
    description:
      'Run a CSS selector against the active renderer window and return matching elements as ' +
      'structured JSON (tag, id, classes, attributes, trimmed text content, bounding rect). ' +
      'Use to verify UI state, locate elements by data-testid, or read computed text. ' +
      "Truncates each element's text to 500 chars and the match list to `maxMatches` (default 50, max 200).",
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1, description: 'CSS selector to query.' },
        maxMatches: { type: 'integer', minimum: 1, maximum: 200, description: 'Max matches (default 50).' },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['selector']
    }
  },
  {
    name: 'console-logs',
    title: 'Renderer console logs',
    description:
      'Return recent renderer-process console messages (info / warn / error / debug / verbose). ' +
      'Filled automatically while McpService is running, capped at 1000 entries (oldest evicted). ' +
      'Filters: `level`, `since` (epoch ms), `limit` (default 100, max 1000), `windowId`.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['verbose', 'debug', 'info', 'warning', 'error'] },
        since: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 1000 },
        windowId: { type: 'integer' }
      }
    }
  },
  {
    name: 'dispatch-event',
    title: 'Dispatch DOM event',
    description:
      'Dispatch a synthetic event of any type on a CSS-selected element. Picks the right Event constructor ' +
      '(Mouse / Keyboard / Pointer / Wheel / Focus / generic Event) and merges the optional `init` dict. ' +
      'Examples: click → `{ selector, type: "click" }`. Hover → `{ selector, type: "mouseenter" }`. ' +
      'Press key → `{ selector, type: "keydown", init: { key: "Enter" } }`.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1 },
        type: { type: 'string', minLength: 1 },
        init: { type: 'object' },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['selector', 'type']
    }
  },
  {
    name: 'type-text',
    title: 'Type text into input',
    description:
      'Set the value of an input/textarea/contenteditable element and fire input+change events. ' +
      'Uses the native HTMLElement value setter so React controlled inputs see the change. ' +
      'Mode `replace` (default) overwrites; `append` concatenates.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1 },
        text: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append'] },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['selector', 'text']
    }
  },
  {
    name: 'evaluate',
    title: 'Evaluate JS in renderer',
    description:
      'Run an arbitrary JavaScript expression in the active renderer\'s main world and return the result ' +
      '(JSON-serialised — functions / undefined / circular refs become null). Footgun by design.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', minLength: 1 },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['expression']
    }
  },
  {
    name: 'exit',
    title: 'Quit the app',
    description:
      'Gracefully quit the Electron app via `app.quit()`. Pending dirty/before-quit handlers still run.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wait-for',
    title: 'Wait for DOM condition',
    description:
      'Poll the renderer DOM until a condition is met or timeout. Conditions: present, absent, ' +
      'text-equals, text-contains, attribute-equals.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1 },
        condition: { type: 'string', enum: ['present', 'absent', 'text-equals', 'text-contains', 'attribute-equals'] },
        value: { type: 'string' },
        attribute: { type: 'string' },
        timeoutMs: { type: 'integer', minimum: 50, maximum: 60000 },
        pollMs: { type: 'integer', minimum: 20, maximum: 2000 },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['selector', 'condition']
    }
  },
  {
    name: 'keyboard-shortcut',
    title: 'Send keyboard shortcut',
    description:
      'Send an OS-level keyboard event (so Electron menu accelerators fire). Use for Ctrl+S, Cmd+R, Escape, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', minLength: 1 },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['Control', 'Shift', 'Alt', 'Meta', 'Cmd', 'Ctrl', 'Super'] }
        },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['key']
    }
  },
  {
    name: 'devtools',
    title: 'Toggle Chromium DevTools',
    description: "Open / close / toggle the renderer's DevTools panel.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'close', 'toggle'] },
        mode: { type: 'string', enum: ['right', 'bottom', 'left', 'undocked', 'detach'] },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      }
    }
  },
  {
    name: 'window-info',
    title: 'Active window info',
    description:
      'Snapshot of the active BrowserWindow: bounds, content size, title, focus / minimize / maximize / fullscreen / visible flags.',
    inputSchema: { type: 'object', properties: {
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      } }
  },
  {
    name: 'storage',
    title: 'Renderer localStorage',
    description: "Read or modify the renderer's localStorage. Actions: get, set, remove, clear, keys.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'remove', 'clear', 'keys'] },
        key: { type: 'string' },
        value: { type: 'string' },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['action']
    }
  },
  {
    name: 'scroll-into-view',
    title: 'Scroll element into view',
    description: 'Call el.scrollIntoView on a CSS-selected element with optional behavior/block/inline.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1 },
        behavior: { type: 'string', enum: ['auto', 'smooth', 'instant'] },
        block: { type: 'string', enum: ['start', 'center', 'end', 'nearest'] },
        inline: { type: 'string', enum: ['start', 'center', 'end', 'nearest'] },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['selector']
    }
  },
  {
    name: 'inject-css',
    title: 'Inject CSS rules',
    description:
      'Append a <style> tag with arbitrary CSS rules. Useful to debug hover/focus states without rebuild. ' +
      'Idempotent per id.',
    inputSchema: {
      type: 'object',
      properties: {
        rules: { type: 'string', minLength: 1 },
        id: { type: 'string' },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['rules']
    }
  },
  {
    name: 'wait',
    title: 'Sleep',
    description: 'Block for `ms` milliseconds. Capped at 30000.',
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'integer', minimum: 1, maximum: 30000 } },
      required: ['ms']
    }
  },
  {
    name: 'get-computed-style',
    title: 'Read computed CSS',
    description:
      'Return getComputedStyle values for a CSS-selected element. Pass `properties` to filter, omit for all.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', minLength: 1 },
        properties: { type: 'array', items: { type: 'string' } },
        pseudoElement: { type: 'string' },
        windowId: { type: 'integer', description: "Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible." }
      },
      required: ['selector']
    }
  },
  {
    name: 'get-windows',
    title: 'List BrowserWindows',
    description:
      'Return every active BrowserWindow with its id (= webContents.id), title, bounds and ' +
      'focus / visible / minimized / maximized / fullscreen flags. Pair with the `windowId` argument ' +
      'accepted by every renderer-facing tool to target a specific window in multi-window setups.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'drag-drop',
    title: 'Drag and drop',
    description:
      'Simulate an HTML5 drag-and-drop from a source element to a target element. ' +
      'Fires the full event sequence (dragstart → walked dragenter/dragover → sustained dragover → drop → dragend) ' +
      'with a fresh DataTransfer. Use to reorder workbench tabs, split editor groups (drop near a group edge), ' +
      'reorder tree nodes — anything wired through HTML5 DnD.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceSelector: { type: 'string', minLength: 1 },
        targetSelector: { type: 'string', minLength: 1 },
        dropPosition: { type: 'string', enum: ['center', 'top', 'right', 'bottom', 'left'] },
        steps: { type: 'integer', minimum: 1, maximum: 50 },
        sustainedHovers: { type: 'integer', minimum: 0, maximum: 20 },
        windowId: { type: 'integer', description: 'Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible.' }
      },
      required: ['sourceSelector', 'targetSelector']
    }
  },
  {
    name: 'mouse-input',
    title: 'Trusted mouse input',
    description:
      'Inject OS-level, trusted (isTrusted=true) mouse input via webContents.sendInputEvent — the mouse ' +
      'counterpart of `keyboard-shortcut`. Use for interactions that ignore synthetic DOM events: pointer-capture ' +
      'drags (React Flow connections), hover-opened submenus (ECUI ContextMenu / native-style menus), Monaco wheel ' +
      'scrolling. Point comes from a `selector` (rect centre) or explicit x/y (CSS px). Gestures: move (hover), ' +
      'click, drag (down→move→up; target via toSelector or toX/toY), wheel (scroll by deltaY).',
    inputSchema: {
      type: 'object',
      properties: {
        gesture: { type: 'string', enum: ['move', 'click', 'drag', 'wheel'] },
        selector: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        toSelector: { type: 'string' },
        toX: { type: 'number' },
        toY: { type: 'number' },
        steps: { type: 'integer', minimum: 1, maximum: 60 },
        button: { type: 'string', enum: ['left', 'middle', 'right'] },
        deltaX: { type: 'number' },
        deltaY: { type: 'number' },
        windowId: { type: 'integer', description: 'Target a specific BrowserWindow by `webContents.id` (see `get-windows`). Omit for focused / first-visible.' }
      },
      required: ['gesture']
    }
  }
]

/**
 * Tracks whether restorm was reachable during the LAST forwarded
 * request. Flipped to `false` when a forward fails with a connection
 * error (port closed mid-flight, e.g. user killed restorm). Used to
 * decide when to emit `notifications/tools/list_changed`: every
 * `false → true` transition indicates restorm came back up — possibly
 * with a different tool registry, so Claude should refresh its cache.
 */
let lastSeenUp = false

function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH = no such process. EPERM = exists but we can't signal
    // it (still alive, owned by another user — counts as live).
    return err && err.code === 'EPERM'
  }
}

/**
 * Read every parseable lockfile in DISCOVERY_DIR. Returns the parsed
 * entries plus their on-disk paths so callers can probe + GC.
 */
function readDiscoveryEntries() {
  let entries
  try {
    entries = readdirSync(DISCOVERY_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue
    const path = join(DISCOVERY_DIR, e.name)
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      out.push({ file: path, parseable: false })
      continue
    }
    const pid = Number(parsed.pid)
    const port = Number(parsed.port)
    const token = typeof parsed.token === 'string' ? parsed.token : null
    out.push({
      file: path,
      parseable: true,
      pid: Number.isInteger(pid) ? pid : null,
      port: Number.isInteger(port) && port > 0 ? port : null,
      token,
      projectPath: parsed.projectPath ?? null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : ''
    })
  }
  return out
}

/**
 * Scan the per-pid discovery dir, validate each candidate with an HTTP
 * probe, and return the most-recent reachable entry (`null` if none).
 *
 * "Reachable" means: the recorded pid is still alive AND the recorded
 * port responds to a JSON-RPC `initialize` POST with the recorded
 * bearer token within `HTTP_PROBE_TIMEOUT_MS`. The probe rules out
 * three failure modes a TCP-only check would miss:
 *
 *   - PID reuse after a reboot (recorded pid number now belongs to an
 *     unrelated process — port doesn't respond).
 *   - Another process took the port after restorm crashed (responds,
 *     but rejects our auth → not restorm anymore).
 *   - Restorm restarted and minted a new token without rewriting the
 *     lockfile we cached (token mismatch → 401 → probe fails).
 */
async function discoverRunningRestorm() {
  const candidates = readDiscoveryEntries()
    .filter((c) => c.parseable && c.pid !== null && c.port !== null && isPidAlive(c.pid))
  if (candidates.length === 0) return null
  // Most-recent first. `startedAt` is ISO-8601 so lexical sort works.
  candidates.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  for (const c of candidates) {
    if (await probeMcpEndpoint(c.port, c.token)) {
      return { pid: c.pid, port: c.port, token: c.token, projectPath: c.projectPath, startedAt: c.startedAt }
    }
  }
  return null
}

/**
 * Garbage-collect stale lockfiles in DISCOVERY_DIR. Deletes any entry
 * that fails one of: parseable JSON, integer pid, alive pid, integer
 * port, MCP endpoint responds to an `initialize` probe with the
 * recorded token. Run once at startup to keep the dir bounded — when
 * restorm crashes / is killed -9 / is interrupted by reboot, its
 * lockfile is left behind and would otherwise accumulate forever.
 *
 * Best-effort: unlink failures are swallowed (file may have been
 * removed by another launcher concurrently, or by tmpwatch).
 */
async function gcStaleDiscoveryFiles() {
  const entries = readDiscoveryEntries()
  let removed = 0
  for (const c of entries) {
    if (!c.parseable) {
      try { await fs.unlink(c.file); removed++ } catch { /* gone */ }
      continue
    }
    if (c.pid === null || !isPidAlive(c.pid)) {
      try { await fs.unlink(c.file); removed++ } catch { /* gone */ }
      continue
    }
    if (c.port === null || !(await probeMcpEndpoint(c.port, c.token))) {
      try { await fs.unlink(c.file); removed++ } catch { /* gone */ }
      continue
    }
  }
  if (removed > 0) log('gc removed stale discovery lockfiles', { removed })
}

async function isPortOpen(port) {
  if (port === null || port === undefined) return false
  return new Promise((resolveFn) => {
    const sock = netConnect({ host: HOST, port })
    sock.setTimeout(500)
    sock.once('connect', () => { sock.destroy(); resolveFn(true) })
    sock.once('error', () => { resolveFn(false) })
    sock.once('timeout', () => { sock.destroy(); resolveFn(false) })
  })
}

/**
 * Confirm that a given (port, token) pair points at a live restorm MCP
 * endpoint by sending a real JSON-RPC `initialize` POST. Returns true
 * on a 2xx response, false on any other status / network error /
 * timeout. Used both to validate discovered entries before adopting
 * them and to GC stale lockfiles.
 *
 * Cheaper than a full forward: we don't parse the SSE body, just drain
 * it so the socket can close cleanly. Capped at HTTP_PROBE_TIMEOUT_MS
 * because the endpoint is local — anything slower is treated as dead.
 */
function probeMcpEndpoint(port, token) {
  return new Promise((resolveFn) => {
    if (!Number.isInteger(port) || port <= 0) { resolveFn(false); return }
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 'launcher-probe',
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'mcp-launcher-probe', version: '0.0.0' }
      }
    })
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(payload)
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    let settled = false
    const settle = (ok) => { if (!settled) { settled = true; resolveFn(ok) } }
    const req = httpRequest(
      { host: HOST, port, path: '/', method: 'POST', headers },
      (res) => {
        const ok = typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300
        // Drain the body so the socket can close; we don't care about
        // the parsed payload — only the status code.
        res.resume()
        res.on('end', () => settle(ok))
        res.on('error', () => settle(false))
      }
    )
    req.setTimeout(HTTP_PROBE_TIMEOUT_MS, () => { req.destroy(); settle(false) })
    req.on('error', () => settle(false))
    req.write(payload)
    req.end()
  })
}

/**
 * Poll a specific discovery file for up to `timeoutMs`. Restorm writes
 * the file atomically once its MCP server is bound. Returns the parsed
 * `{port,...}` entry or `null` on timeout.
 */
async function waitForDiscoveryFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const text = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(text)
      if (Number.isInteger(parsed.port) && parsed.port > 0) {
        return parsed
      }
    } catch {
      // Not yet written — retry.
    }
    await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS))
  }
  return null
}

function spawnRestormDetached(discoveryFile) {
  log('restorm not running, spawning detached', { cwd: repoRoot, discoveryFile })
  // `pnpm dev:restorm` → `pnpm --filter restorm run dev` →
  // `electron-vite dev`. The `--` separator passes flags through to
  // the Electron main process. Restorm writes its chosen port to
  // `discoveryFile` once bound.
  //
  // `--inactive-window`: this is a programmatic launch (no human asked for it),
  // so reveal the window WITHOUT stealing OS focus or switching the user's
  // active virtual desktop — it just appears in the background.
  const child = spawn(
    'pnpm',
    ['dev:restorm', '--', '--mcp', '--inactive-window', `--mcp-discovery-file=${discoveryFile}`],
    {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      // Strip the activation tokens so the window doesn't grab focus on Wayland.
      env: inactiveLaunchEnv()
    }
  )
  child.unref()
}

/**
 * Returns `{ becameUp: true }` when restorm transitioned from
 * unreachable → reachable during this call (either we spawned it
 * fresh, or the user restarted it externally and we noticed). Caller
 * uses that signal to emit `notifications/tools/list_changed`.
 *
 * Side effect: sets `currentPort` to the resolved live port.
 */
async function ensureRestormRunning() {
  // Fast path: we already saw a port up; verify it's still listening.
  if (lastSeenUp && currentPort !== null && (await isPortOpen(currentPort))) {
    return { becameUp: false }
  }

  const wasDownBefore = !lastSeenUp

  // Try to reuse a live restorm via the central discovery dir before
  // spawning a fresh one. Useful when the user launched restorm from
  // their dock / a separate terminal. `discoverRunningRestorm` does
  // its own HTTP probe with the recorded token, so a returned entry
  // is already validated — no extra round-trip needed.
  const existing = await discoverRunningRestorm()
  if (existing) {
    currentPort = existing.port
    currentToken = existing.token
    log('restorm already listening (discovered)', { port: existing.port, pid: existing.pid, hasToken: currentToken !== null })
    lastSeenUp = true
    return { becameUp: wasDownBefore }
  }

  // No live instance — spawn one and wait for its discovery file.
  await fs.mkdir(DISCOVERY_DIR, { recursive: true })
  const discoveryFile = join(DISCOVERY_DIR, `launcher-${String(process.pid)}-${String(Date.now())}.json`)
  spawnRestormDetached(discoveryFile)
  const entry = await waitForDiscoveryFile(discoveryFile, SPAWN_WAIT_MS)
  if (!entry) {
    throw new Error(
      `restorm did not announce a port within ${SPAWN_WAIT_MS}ms — check that ` +
      `\`pnpm dev:restorm -- --mcp\` works manually from ${repoRoot}`
    )
  }
  currentPort = entry.port
  currentToken = typeof entry.token === 'string' ? entry.token : null
  log('restorm came up', { port: entry.port, pid: entry.pid, hasToken: currentToken !== null })
  // Cleanup the launcher-specific file (the per-pid lockfile stays
  // for future launchers to discover).
  try { await fs.unlink(discoveryFile) } catch { /* already gone */ }
  lastSeenUp = true
  return { becameUp: wasDownBefore }
}

function isConnectionError(err) {
  const code = err && (err.code || (err.cause && err.cause.code))
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE'
}

/**
 * Forward one JSON-RPC payload (already serialised) to restorm's
 * HTTP MCP endpoint. Resolves with the JSON-RPC reply object, or
 * `null` if the response was an empty 202 (typical for notifications).
 *
 * The streamable-HTTP transport answers in `text/event-stream`:
 * one event named `message`, a single `data: <json>` line, then a
 * blank line. We parse just that — no full SSE state machine needed
 * since each request is its own short-lived response.
 */
async function forward(jsonRpcText) {
  try {
    return await rawForward(jsonRpcText)
  } catch (err) {
    if (isConnectionError(err)) {
      // Restorm went down between our last successful forward and
      // now (user killed it / dev rebuild / crash). Flag the next
      // request to reprobe + emit list_changed when it comes back.
      lastSeenUp = false
    } else if (err && err.httpStatus === 401) {
      // Token mismatch: usually means restorm restarted on the same
      // ephemeral port between our two requests and minted a new
      // token. Invalidate our cache + the live-flag so the next call
      // re-runs discovery, picks up the new token from the lockfile,
      // and emits a fresh `tools/list_changed` for Claude.
      log('forward got 401 — invalidating cached token and forcing rediscovery')
      currentToken = null
      lastSeenUp = false
    }
    throw err
  }
}

function rawForward(jsonRpcText) {
  return new Promise((resolveFn, rejectFn) => {
    if (currentPort === null) {
      rejectFn(new Error('rawForward called before restorm port was discovered'))
      return
    }
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(jsonRpcText)
    }
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`
    const req = httpRequest(
      {
        host: HOST,
        port: currentPort,
        path: '/',
        method: 'POST',
        headers
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode === 202 || body.length === 0) {
            resolveFn(null)
            return
          }
          if (res.statusCode && res.statusCode >= 400) {
            const httpErr = new Error(`MCP HTTP ${res.statusCode}: ${body.slice(0, 500)}`)
            // Tag the status so `forward()` can distinguish auth failures
            // (401 → invalidate cached token) from generic 4xx/5xx.
            httpErr.httpStatus = res.statusCode
            rejectFn(httpErr)
            return
          }
          const match = /^data: (.*)$/m.exec(body)
          if (!match) {
            rejectFn(new Error(`MCP response missing data line: ${body.slice(0, 500)}`))
            return
          }
          try {
            resolveFn(JSON.parse(match[1]))
          } catch (e) {
            rejectFn(new Error(`MCP response JSON parse failed: ${e.message}`))
          }
        })
      }
    )
    req.on('error', rejectFn)
    req.write(jsonRpcText)
    req.end()
  })
}

function writeReply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function makeErrorReply(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message }
  }
}

/**
 * Tools to advertise while restorm is down: the last live `tools/list` we
 * cached (always the real, current set), falling back to the hand-written
 * `BUILTIN_TOOLS` only on a cold first run before any cache exists.
 */
function fallbackTools() {
  try {
    const cached = JSON.parse(readFileSync(TOOLS_CACHE_FILE, 'utf8'))
    if (Array.isArray(cached) && cached.length > 0) return cached
  } catch { /* no/invalid cache — fall back below */ }
  return BUILTIN_TOOLS
}

/** Persist a live `tools/list` result so the next session is in sync. */
async function cacheTools(tools) {
  try {
    await fs.writeFile(TOOLS_CACHE_FILE, JSON.stringify(tools))
  } catch (err) {
    log('failed to cache tools/list', { error: String(err) })
  }
}

/**
 * Decide how to handle a request without spawning restorm. Returns a
 * synthetic reply for the cheap protocol calls (`initialize`,
 * `tools/list`, the `notifications/initialized` no-op), and `null`
 * otherwise — the caller then ensures restorm is running and
 * forwards the request.
 */
function trySyntheticReply(parsed) {
  if (parsed.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: parsed.id ?? null,
      result: {
        protocolVersion: parsed.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'restorm', version: '0.0.0-launcher' }
      }
    }
  }
  if (parsed.method === 'tools/list' && !lastSeenUp) {
    return {
      jsonrpc: '2.0',
      id: parsed.id ?? null,
      result: { tools: fallbackTools() }
    }
  }
  // `notifications/initialized` and any other notification with no
  // id while restorm is down — silently swallow; restorm will get a
  // fresh handshake when it spawns.
  if (!('id' in parsed) && !lastSeenUp) {
    return undefined
  }
  return null
}

async function handleLine(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    writeReply(makeErrorReply(null, -32700, `Parse error: ${String(err)}`))
    return
  }

  // Startup `tools/list`: if a restorm is ALREADY running (discoverable via the
  // lockfile, no spawn), forward to it so a fresh session gets the CURRENT tool
  // set. Without this the synthetic reply below serves the on-disk cache, which
  // shadows a just-added tool / param until the first tool *call* forces a live
  // refresh — so a brand-new session never sees it. We deliberately do NOT spawn
  // here (that would make Claude's startup heavy); only an instance already up
  // is adopted. On any probe/forward failure we fall through to the cache.
  if (parsed.method === 'tools/list' && !lastSeenUp) {
    try {
      const existing = await discoverRunningRestorm()
      if (existing) {
        currentPort = existing.port
        currentToken = existing.token
        lastSeenUp = true
        const reply = await forward(text)
        if (reply !== null) writeReply(reply)
        if (Array.isArray(reply?.result?.tools)) void cacheTools(reply.result.tools)
        return
      }
    } catch (err) {
      lastSeenUp = false
      log('startup tools/list live-probe failed, serving cached fallback', { error: String(err) })
    }
  }

  const synthetic = trySyntheticReply(parsed)
  if (synthetic === undefined) return // notification swallowed
  if (synthetic !== null) {
    writeReply(synthetic)
    return
  }

  // From here, the request needs the real backend.
  let becameUp = false
  try {
    ;({ becameUp } = await ensureRestormRunning())
  } catch (err) {
    writeReply(makeErrorReply(parsed.id ?? null, -32000, String(err)))
    return
  }

  try {
    const reply = await forward(text)
    if (reply !== null) writeReply(reply)
    // Keep the on-disk fallback in sync with restorm's real tool set.
    if (parsed.method === 'tools/list' && Array.isArray(reply?.result?.tools)) {
      void cacheTools(reply.result.tools)
    }
  } catch (err) {
    log('forward failed', { error: String(err) })
    writeReply(makeErrorReply(parsed.id ?? null, -32000, String(err)))
    return
  }

  // Restorm transitioned from unreachable → reachable: emit a
  // `tools/list_changed` so Claude refreshes its cache. Covers both
  // the initial spawn at session start and a mid-session restart
  // (user killed restorm and brought it back up — possibly with a
  // different tool registry after a rebuild).
  if (becameUp) {
    writeReply({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
  }
}

/**
 * Manual mode: run when invoked from a TTY (typically via
 * `pnpm dev:restorm:mcp`). Sweeps the discovery dir synchronously,
 * then spawns `pnpm dev:restorm -- --mcp [...extraArgs]` in the
 * foreground — stdio inherited so the user sees Vite + Electron
 * logs — and waits for it to exit. Extra args supplied after `--`
 * (e.g. `pnpm dev:restorm:mcp -- -o /path/to.restorm`) are
 * forwarded verbatim to restorm's CLI so the user can open a file
 * straight from the launcher. No JSON-RPC handling: the launcher
 * is just a cleanup-then-run wrapper here.
 */
async function runManualMode() {
  // pnpm keeps its `--` separator in the spawned script's argv, so
  // `pnpm dev:restorm:mcp -- -o /path` reaches us as
  // `['--', '-o', '/path']`. If we re-injected that leading `--` into
  // the inner `pnpm dev:restorm -- --mcp ...` invocation, Electron
  // would stop parsing flags at the second `--` and the `-o /path`
  // pair would land as positional argv instead of opening the file.
  // Strip the leading separator so forwarded flags reach Electron's
  // CLI parser as actual flags.
  const rawArgs = process.argv.slice(2)
  const extraArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  log('manual mode (TTY) — running cleanup then spawning restorm in foreground', extraArgs.length > 0 ? { extraArgs } : undefined)
  await gcStaleDiscoveryFiles()
  // `--inactive-window`: reveal the window WITHOUT stealing OS focus or
  // switching the active virtual desktop — `dev:restorm:mcp` is launched for
  // automation/agent use, so it should appear in the background rather than
  // grabbing the user's focus.
  const child = spawn(
    'pnpm',
    ['dev:restorm', '--', '--mcp', '--inactive-window', ...extraArgs],
    // Strip the activation tokens so the window doesn't grab focus on Wayland.
    { cwd: repoRoot, stdio: 'inherit', env: inactiveLaunchEnv() }
  )
  // Forward Ctrl-C cleanly: kill the child, let it shut down restorm,
  // then exit ourselves. SIGTERM follows the same path.
  const forward = (signal) => () => {
    if (!child.killed) child.kill(signal)
  }
  process.on('SIGINT', forward('SIGINT'))
  process.on('SIGTERM', forward('SIGTERM'))
  await new Promise((resolveFn) => {
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal)
      else process.exit(code ?? 0)
      resolveFn()
    })
  })
}

async function main() {
  if (process.stdin.isTTY) {
    await runManualMode()
    return
  }
  // JSON-RPC server mode (Claude Code spawned us via .mcp.json with
  // a piped stdin). Sweep stale lockfiles before serving any request:
  // restorm only cleans its own lockfile on graceful `before-quit`;
  // crashes / -9 / reboots leave carcasses behind, and on a system
  // whose /tmp survives reboots a recycled PID could even pass the
  // liveness check. Fire-and-forget so a slow probe doesn't delay
  // the first response.
  void gcStaleDiscoveryFiles().catch((err) => log('gc failed', { error: String(err) }))
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const text = line.trim()
    if (text.length === 0) continue
    await handleLine(text)
  }
}

main().catch((err) => {
  log('fatal', { error: String(err) })
  process.exit(1)
})
