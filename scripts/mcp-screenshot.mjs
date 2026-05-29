#!/usr/bin/env node
/**
 * Save a screenshot of the running restorm window to a file — so an agent can
 * attach it (Telegram, etc.). The restorm MCP `screenshot` tool only returns
 * the image inline to the model; this calls the same MCP route directly over
 * HTTP (reading the per-pid lockfile for port + token) and writes the PNG.
 *
 * Usage:
 *   node scripts/mcp-screenshot.mjs [outPath] [--window <webContentsId>]
 *   node scripts/mcp-screenshot.mjs                      # → /tmp/restorm-shot-<ts>.png
 *   node scripts/mcp-screenshot.mjs /tmp/box.png
 *
 * Prints the saved absolute path on success (and nothing else on stdout), so
 * callers can `PNG=$(node scripts/mcp-screenshot.mjs)`.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const DISCOVERY_DIR = '/tmp/restorm-mcp'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const positional = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== arg('--window'))
const outPath = positional || `/tmp/restorm-shot-${Date.now()}.png`
const windowId = arg('--window')

/** Pick the live, interactive restorm lockfile (skip the e2e tmp server and
 * any whose pid is dead). Newest startedAt wins when several qualify. */
function pickLockfile() {
  let best = null
  for (const f of readdirSync(DISCOVERY_DIR)) {
    if (!f.endsWith('.json')) continue
    let j
    try { j = JSON.parse(readFileSync(`${DISCOVERY_DIR}/${f}`, 'utf8')) } catch { continue }
    if (String(j.projectPath || '').includes('tests/e2e')) continue
    try { process.kill(j.pid, 0) } catch { continue } // dead pid → skip
    if (!best || new Date(j.startedAt) > new Date(best.startedAt)) best = j
  }
  return best
}

function parseRpc(body) {
  // Streamable-HTTP answers in text/event-stream: a `data: <json>` line.
  const line = body.split('\n').find((l) => l.startsWith('data:'))
  return JSON.parse(line ? line.slice(5).trim() : body)
}

async function main() {
  const lock = pickLockfile()
  if (!lock) {
    console.error('mcp-screenshot: no live interactive restorm found (is `pnpm dev:restorm:mcp` running?)')
    process.exit(1)
  }
  const url = `http://127.0.0.1:${lock.port}/`
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${lock.token}`
  }
  const rpc = async (method, params) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) })
    const text = await res.text()
    if (res.status === 401) throw new Error('mcp-screenshot: 401 (token mismatch — restorm restarted? re-read lockfile)')
    return text.length ? parseRpc(text) : null
  }

  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-screenshot', version: '1' } })
  const args = windowId ? { windowId: Number(windowId) } : {}
  const reply = await rpc('tools/call', { name: 'screenshot', arguments: args })
  const image = reply?.result?.content?.find((c) => c.type === 'image')
  if (!image?.data) {
    console.error('mcp-screenshot: no image in reply:', JSON.stringify(reply).slice(0, 400))
    process.exit(1)
  }
  writeFileSync(outPath, Buffer.from(image.data, 'base64'))
  process.stdout.write(outPath + '\n')
}

main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1) })
