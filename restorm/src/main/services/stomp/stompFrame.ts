/**
 * STOMP 1.1/1.2 frame codec — pure text ⇄ object functions, no socket I/O.
 *
 * Wire shape (https://stomp.github.io/stomp-specification-1.2.html#STOMP_Frames):
 *
 *   COMMAND
 *   header1:value1
 *   header2:value2
 *
 *   Body^@
 *
 * A frame is COMMAND, then header lines (`key:value`), then a blank line,
 * then the body, terminated by a NULL byte (`\0`). Extra EOLs between two
 * NULL-terminated frames are heart-beats (a lone EOL sent to keep the
 * connection alive) and carry no frame — {@link parseStompFrames} skips them.
 *
 * Header escaping (1.1/1.2): `\\` → `\`, `\n` → LF, `\c` → `:`, and (1.2 only)
 * `\r` → CR. CONNECT/CONNECTED frames are the one exception — their headers
 * are NOT escaped, for backward compatibility with STOMP 1.0 clients/servers
 * that predate the escaping rule.
 */

const NULL_BYTE = '\0'
/** Frames whose headers are never escaped (STOMP 1.0 backward-compat). */
const UNESCAPED_HEADER_COMMANDS = new Set(['CONNECT', 'STOMP', 'CONNECTED'])

export interface StompFrame {
  command: string
  headers: Record<string, string>
  body: string
}

function escapeHeaderValue(value: string, command: string): string {
  if (UNESCAPED_HEADER_COMMANDS.has(command)) return value
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/:/g, '\\c')
}

function unescapeHeaderValue(value: string, command: string): string {
  if (UNESCAPED_HEADER_COMMANDS.has(command)) return value
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) {
      const next = value[i + 1]
      if (next === 'n') { out += '\n'; i++; continue }
      if (next === 'r') { out += '\r'; i++; continue }
      if (next === 'c') { out += ':'; i++; continue }
      if (next === '\\') { out += '\\'; i++; continue }
      // Not a recognised escape — keep the backslash literal (malformed input).
      out += ch
      continue
    }
    out += ch ?? ''
  }
  return out
}

/**
 * Encode a frame to its wire text. Auto-fills `content-length` (byte count,
 * UTF-8) when the body is non-empty and the caller didn't set one — the
 * spec-recommended way to let a body safely contain embedded NULs, and what
 * most STOMP client libraries do by default.
 */
export function encodeStompFrame(frame: StompFrame): string {
  const headers = { ...frame.headers }
  if (frame.body.length > 0 && headers['content-length'] === undefined) {
    headers['content-length'] = String(Buffer.byteLength(frame.body, 'utf8'))
  }
  const lines = [frame.command]
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`${escapeHeaderValue(key, frame.command)}:${escapeHeaderValue(value, frame.command)}`)
  }
  return `${lines.join('\n')}\n\n${frame.body}${NULL_BYTE}`
}

/**
 * Parse ONE frame starting at `start` (command + headers + body), returning
 * the frame (or null for a malformed/empty command) and the index to resume
 * scanning from. Repeated headers: the FIRST occurrence wins, per spec.
 *
 * Body boundary: when the headers declare `content-length` (a byte count),
 * the body is EXACTLY that many characters — the spec-sanctioned way for a
 * body to safely contain an embedded NUL byte, which would otherwise be
 * mistaken for the frame terminator. Without `content-length`, the body ends
 * at the first NUL byte. Either way, scanning resumes just past the NUL that
 * terminates the frame.
 */
function parseFrameAt(raw: string, start: number): { frame: StompFrame | null; nextIndex: number } {
  // The header/body boundary is the first blank line. Header VALUES can only
  // contain an escaped `\n` (`\` + `n`), never a raw newline byte, so the
  // first blank-line match is always the real boundary, never a false
  // positive from inside a header.
  const boundary = /\r?\n\r?\n/.exec(raw.slice(start))
  if (!boundary) {
    // No blank line at all — malformed / truncated frame; skip to the next
    // NUL (or the end) so a single bad frame doesn't wedge the whole scan.
    const nullIdx = raw.indexOf(NULL_BYTE, start)
    return { frame: null, nextIndex: nullIdx === -1 ? raw.length : nullIdx + 1 }
  }
  const headerPart = raw.slice(start, start + boundary.index)
  const bodyStart = start + boundary.index + boundary[0].length

  const headerLines = headerPart.split(/\r?\n/)
  const command = (headerLines.shift() ?? '').trim()

  const headers: Record<string, string> = {}
  for (const line of headerLines) {
    if (line === '') continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = unescapeHeaderValue(line.slice(0, colonIdx), command)
    if (key in headers) continue // first occurrence wins
    headers[key] = unescapeHeaderValue(line.slice(colonIdx + 1), command)
  }

  if (command === '') {
    const nullIdx = raw.indexOf(NULL_BYTE, bodyStart)
    return { frame: null, nextIndex: nullIdx === -1 ? raw.length : nullIdx + 1 }
  }

  // Treated as a character count here (not a true UTF-8 byte count) —
  // adequate for the ASCII/JSON payloads restorm's mock + e2e fixtures use; a
  // body with multi-byte characters AND an explicit content-length is the one
  // case this under/over-trims.
  const contentLength = headers['content-length']
  const noLengthNullIdx = raw.indexOf(NULL_BYTE, bodyStart)
  const bodyEnd = contentLength !== undefined && /^\d+$/.test(contentLength)
    ? Math.min(bodyStart + Number(contentLength), raw.length)
    : (noLengthNullIdx === -1 ? raw.length : noLengthNullIdx)
  const body = raw.slice(bodyStart, bodyEnd)

  const terminatorIdx = raw.indexOf(NULL_BYTE, bodyEnd)
  const nextIndex = terminatorIdx === -1 ? raw.length : terminatorIdx + 1
  return { frame: { command, headers, body }, nextIndex }
}

/**
 * Parse a raw WebSocket text message into zero or more STOMP frames. A
 * single message usually carries exactly one frame (the common convention
 * STOMP-over-WebSocket clients + brokers follow), but this tolerates several
 * NULL-terminated frames concatenated in one message, and skips heart-beat
 * EOLs (a lone `\n` / `\r\n` sent between frames to keep the socket alive).
 */
export function parseStompFrames(raw: string): StompFrame[] {
  const frames: StompFrame[] = []
  let i = 0
  while (i < raw.length) {
    while (i < raw.length && (raw[i] === '\n' || raw[i] === '\r')) i++
    if (i >= raw.length) break
    const { frame, nextIndex } = parseFrameAt(raw, i)
    if (frame) frames.push(frame)
    if (nextIndex <= i) break // never spin on malformed input that can't advance
    i = nextIndex
  }
  return frames
}

/** The literal heart-beat wire text (a lone LF) a client/server sends on the
 * negotiated interval to keep the connection alive between real frames. */
export const STOMP_HEARTBEAT_FRAME = '\n'
