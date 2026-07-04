/**
 * Pure Redis command helpers shared by the main-process execution service and
 * the renderer's command-mode args input — kept dependency-free (no Node /
 * Electron APIs) so both bundles can import it without dragging main code
 * into the renderer.
 */

import { DEFAULT_REDIS_XREAD_BLOCK_CAP_MS } from '../config/constants'

/** Parse a freeform command line (or a raw args string) into tokens. Splits on
 * whitespace, honouring single/double-quoted segments so an arg carrying
 * spaces (e.g. a JSON payload) survives — a plain `.split(' ')` would shred
 * it. */
export function parseFreeformCommand(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

/** Cap a blocking `XREAD`'s `BLOCK <ms>` argument at `capMs` (default 5s) — a
 * one-shot command client must never hang indefinitely on `BLOCK 0`. Returns a
 * new args array; a no-op when `BLOCK` is absent. Case-insensitive (Redis
 * commands are conventionally uppercase but accept any case). */
export function capXreadBlockMs(args: string[], capMs = DEFAULT_REDIS_XREAD_BLOCK_CAP_MS): string[] {
  const idx = args.findIndex((a) => a.toUpperCase() === 'BLOCK')
  if (idx < 0 || idx + 1 >= args.length) return args
  const requested = Number.parseInt(args[idx + 1] ?? '', 10)
  if (!Number.isFinite(requested) || requested === 0 || requested > capMs) {
    const next = [...args]
    next[idx + 1] = String(capMs)
    return next
  }
  return args
}

/** Format a raw ioredis reply (string / number / null / Buffer / nested
 * array) into the display string the response panel + history show. */
export function formatRedisReply(reply: unknown): string {
  if (reply === null || reply === undefined) return '(nil)'
  if (typeof reply === 'string' || typeof reply === 'number') return String(reply)
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(reply)) return reply.toString('utf8')
  try {
    return JSON.stringify(reply)
  } catch {
    // JSON.stringify only throws on a circular structure — `String()` on an
    // arbitrary object would just print the useless default
    // `[object Object]`, so surface a sentinel instead.
    return '(unserializable reply)'
  }
}

/** Turn a Redis connect/command failure into an actionable message. ioredis
 * surfaces bare socket errors whose `.message` is often just a code. */
export function describeRedisConnectError(err: unknown, url: string): string {
  const e = err as { message?: string; code?: string } | undefined
  const code = typeof e?.code === 'string' ? e.code : undefined
  const at = url ? ` at ${url}` : ''
  switch (code) {
    case 'ECONNREFUSED':
      return `Connection refused — no Redis server is listening${at}.`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Host not found — the Redis server address${at} could not be resolved.`
    case 'ETIMEDOUT':
      return `Connection timed out — the Redis server${at} did not respond.`
    case 'ECONNRESET':
      return `Connection reset — the Redis server${at} closed the connection.`
    case 'NOAUTH':
    case 'WRONGPASS':
      return `Authentication failed${at} — check the password.`
    default:
      break
  }
  const msg = typeof e?.message === 'string' ? e.message.trim() : ''
  if (msg.length > 0) return msg
  return `Redis connection failed${at}.`
}
