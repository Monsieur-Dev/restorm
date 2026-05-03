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
const PROTOCOL_VERSION = '2025-03-26'

// Where running restorm instances drop their per-pid lockfile. Must
// match `MCP_DISCOVERY_DIR` in `restorm/src/main/services/mcpDiscovery.ts`.
const DISCOVERY_DIR = join(tmpdir(), 'restorm-mcp')

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
 * Scan the per-pid discovery dir, return the most-recent live entry,
 * or `null` if none. "Live" = the recorded pid still exists.
 */
function discoverRunningRestorm() {
  let entries
  try {
    entries = readdirSync(DISCOVERY_DIR, { withFileTypes: true })
  } catch {
    return null
  }
  const live = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue
    const path = join(DISCOVERY_DIR, e.name)
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }
    const pid = Number(parsed.pid)
    const port = Number(parsed.port)
    if (!Number.isInteger(pid) || !Number.isInteger(port) || port <= 0) continue
    if (!isPidAlive(pid)) continue
    const token = typeof parsed.token === 'string' ? parsed.token : null
    live.push({ pid, port, token, projectPath: parsed.projectPath ?? null, startedAt: parsed.startedAt ?? '' })
  }
  if (live.length === 0) return null
  // Most-recent first. `startedAt` is ISO-8601 so lexical sort works.
  live.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  return live[0]
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
  const child = spawn(
    'pnpm',
    ['dev:restorm', '--', '--mcp', `--mcp-discovery-file=${discoveryFile}`],
    {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
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
  // their dock / a separate terminal.
  const existing = discoverRunningRestorm()
  if (existing && (await isPortOpen(existing.port))) {
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
            rejectFn(new Error(`MCP HTTP ${res.statusCode}: ${body.slice(0, 500)}`))
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
      result: { tools: BUILTIN_TOOLS }
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

async function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const text = line.trim()
    if (text.length === 0) continue
    await handleLine(text)
  }
}

process.on('SIGTERM', () => { process.exit(0) })
process.on('SIGINT', () => { process.exit(0) })

main().catch((err) => {
  log('fatal', { error: String(err) })
  process.exit(1)
})
