/**
 * Payload scrubbing — the fail-closed sanitiser every outbound diagnostic
 * payload (crash report, telemetry event, user feedback) must pass through
 * before it leaves the process.
 *
 * The problem it solves: a crash report is the single richest leak vector an
 * API client has. A stack trace carries absolute file paths (whose home segment
 * IS the user's name), an error message carries whatever string blew up, and an
 * SDK's breadcrumb trail carries the URLs, `Authorization` headers and request
 * bodies of every call the user made — i.e. exactly the secrets the app exists
 * to hold. Shipping any of that to a third-party ingestion service without
 * scrubbing would be indefensible for a privacy-first product.
 *
 * Two halves, and the second is DEFINED IN TERMS OF the first:
 *   - {@link scrubPayload} rewrites a value, replacing every match with a
 *     stable `[redacted-*]` marker.
 *   - {@link assertScrubbed} THROWS unless scrubbing the value again would
 *     change nothing. Deriving the verdict from the rewriter instead of from a
 *     parallel set of detectors is what makes the fail-closed contract hold by
 *     construction: the two cannot disagree, so neither a missing detector nor
 *     an unrecognised rewrite can produce a false pass. The whole guarantee
 *     reduces to one directly testable property — `scrubString` is idempotent.
 *     A send path calls `assertScrubbed` last, so a bug in a future transform
 *     surfaces as a thrown error rather than a silent leak.
 *
 * The structural walk mirrors `JSON.stringify` semantics rather than a naive key
 * walk, because the difference is a leak: `new URL(...)` has no enumerable keys
 * yet serialises to its full href, query string included.
 *
 * Deliberately conservative: over-redaction costs debuggability, under-redaction
 * costs a data breach. Where the two conflict the aggressive rule wins, with one
 * calibrated exception — file paths keep their structure and only the home
 * directory collapses to `~`, because the username is the PII and the rest of
 * the path is the whole value of a stack trace.
 *
 * Generic + dependency-free (no electron, no node): usable from main, preload,
 * renderer, a worker, or a unit test.
 */

/** Replacement marker for a value redacted by key (header, secret-ish field). */
export const REDACTED = '[redacted]'
/** Replacement marker for a stripped http(s) / ws(s) URL. */
export const REDACTED_URL = '[redacted-url]'
/** Replacement marker for an e-mail address. */
export const REDACTED_EMAIL = '[redacted-email]'
/** Replacement marker for an IPv4 literal. */
export const REDACTED_IP = '[redacted-ip]'
/** Replacement marker for a token / key / high-entropy blob. */
export const REDACTED_TOKEN = '[redacted-token]'
/** Replacement marker for a request / response body. */
export const REDACTED_BODY = '[redacted-body]'
/** Replacement marker for a value nested past `maxDepth`. */
export const REDACTED_DEPTH = '[redacted-depth]'
/** Replacement marker for a value already visited on this walk (cycle). */
export const REDACTED_CIRCULAR = '[circular]'

/** How a matched http(s) / ws(s) URL is rewritten. */
export type UrlPolicy =
  /** Whole URL replaced by {@link REDACTED_URL}. The default — an internal
   * hostname (`gitlab.acme-internal.corp`) is itself sensitive. */
  | 'strip'
  /** Keep `scheme://host` and drop path, query, fragment and userinfo. Opt-in,
   * for a consumer that has decided the destination host is worth the risk. */
  | 'host'

export interface ScrubOptions {
  /**
   * Extra object keys whose value is always redacted, on top of the built-in
   * sensitive-key set. Matched loosely (case-insensitive, non-alphanumerics
   * ignored) so `x-api-key`, `xApiKey` and `X_API_KEY` all hit the same entry.
   */
  redactKeys?: readonly string[] | undefined
  /**
   * Literal secret values to blank wherever they appear, at any depth and even
   * mid-sentence. This is how a host app feeds in the secrets it already knows
   * (resolved env-file secrets, a vault value, a session token) so they are
   * caught even when they carry no recognisable shape.
   */
  redactValues?: readonly string[] | undefined
  /**
   * Object keys whose STRING value is a structural identifier the transport
   * requires verbatim, not free content — a Sentry `event_id` / `trace_id`, a
   * correlation id, a request id. Their values pass through untouched, exempt
   * from every string detector (matched loosely, like {@link redactKeys}).
   *
   * The narrow exception to the fail-closed posture, and deliberately narrow:
   * only a STRING under one of these exact keys is exempted — a nested object is
   * still walked in full, so this cannot be used to smuggle a subtree past the
   * gate. It exists because the entropy catch-all cannot tell a 32-hex random id
   * from a 32-hex secret, and redacting the former corrupts the very identifier
   * the ingest endpoint validates: an event with a redacted `event_id` is
   * rejected outright, so scrubbing it drops EVERY report rather than protecting
   * anything. Name only keys whose value the producer generates and the consumer
   * requires — never a key that could carry user content.
   */
  preserveKeys?: readonly string[] | undefined
  /** URL rewrite policy. Defaults to `'strip'`. */
  urlPolicy?: UrlPolicy | undefined
  /**
   * Absolute home directory of the current user, rewritten to `~` wherever it
   * appears. Supply `os.homedir()` from a Node context; when omitted only the
   * generic platform shapes (`/home/<user>`, `/Users/<user>`,
   * `C:\Users\<user>`) are collapsed.
   */
  homeDir?: string | undefined
  /** Nesting depth past which a value collapses to {@link REDACTED_DEPTH}.
   * Defaults to 8 — deep enough for a realistic SDK event, shallow enough that
   * a pathological object can't stall the walk. */
  maxDepth?: number | undefined
  /**
   * Maximum length (in characters) of any single string value AFTER scrubbing.
   * A string longer than this is cut to the cap with a `…[+N chars]` marker
   * appended. Defence-in-depth against bulk user content — a whole imported
   * document, a pasted spec, a large response body — riding into a payload in
   * one string field, where the secret/URL detectors (which look for shapes,
   * not size) would pass it through. The cut happens last, after every detector
   * has already run and redacted the head, so it only drops trailing bulk, not
   * anything a detector would have caught. Unset means no length cap.
   */
  maxStringLength?: number | undefined
}

/** One place a detector fired on a value that was supposed to be clean. */
export interface ScrubViolation {
  /** JSON-ish path to the offending value, e.g. `breadcrumbs[2].data.url`. */
  path: string
  /** Which detector fired — `sensitive-key`, `url`, `email`, `ip`, `token`,
   * `jwt`, `auth-scheme`, `home-path`, `literal-value`, `body-key`. */
  rule: string
}

/**
 * Thrown by {@link assertScrubbed}. Carries every violation so the caller can
 * log WHICH rule fired without logging the offending value itself (the message
 * deliberately names paths + rules only — never the leaked content).
 */
export class PayloadNotScrubbedError extends Error {
  readonly violations: readonly ScrubViolation[]

  constructor(violations: readonly ScrubViolation[]) {
    const preview = violations.slice(0, 5).map((v) => `${v.path} (${v.rule})`).join(', ')
    const more = violations.length > 5 ? ` … +${String(violations.length - 5)} more` : ''
    super(`Payload is not scrubbed: ${String(violations.length)} violation(s): ${preview}${more}`)
    this.name = 'PayloadNotScrubbedError'
    this.violations = violations
  }
}

// ---------------------------------------------------------------------------
// Key classification
// ---------------------------------------------------------------------------

/**
 * Normalise an object key for matching: lower-case and drop every
 * non-alphanumeric character, so `X-Api-Key`, `x_api_key` and `xApiKey` all
 * collapse to `xapikey`. Substring matching on the normalised form is then
 * enough to catch every casing/separator convention in the wild.
 */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Fragments that mark a key as holding a credential. Matched as substrings of
 * the normalised key, so `refreshToken`, `x-auth-token` and `TOKEN` all hit
 * `token`. Bare `auth` is deliberately ABSENT — it would swallow `author`,
 * a legitimate field — and is covered by `authorization` / `token` anyway.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'authorization',
  'cookie',
  'token',
  'apikey',
  'accesskey',
  'secretkey',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'credential',
  'privatekey',
  'signature',
  'sessionid',
  'bearer',
  'otp'
] as const

/**
 * Keys whose value is a request / response body. Dropped wholesale rather than
 * walked: a body is arbitrary user payload (the API call's JSON, a file upload,
 * a GraphQL variables map) with no reliable structure to scrub field by field,
 * so the only safe treatment is not to send it.
 */
const BODY_KEY_FRAGMENTS = [
  'body',
  'requestbody',
  'responsebody',
  'rawbody',
  'payload',
  'postdata',
  'formdata',
  // `data` is what axios calls the body on BOTH sides — `config.data` is the
  // request, `response.data` is the response — and fetch wrappers copy the
  // name. Dropping it unconditionally also costs an SDK breadcrumb's `data`
  // object, which is real debuggability lost; the trade is deliberate and
  // follows this module's stated posture, that where the two conflict the
  // aggressive rule wins. Scoping it to known parents was tried and rejected:
  // it silently missed `config.data`, and the next client to invent its own
  // wrapper name would have slipped through the same way.
  'data'
] as const

function isSensitiveKey(key: string, extra: readonly string[]): boolean {
  const n = normaliseKey(key)
  if (n === '') return false
  for (const fragment of SENSITIVE_KEY_FRAGMENTS) {
    if (n.includes(fragment)) return true
  }
  for (const raw of extra) {
    const e = normaliseKey(raw)
    if (e !== '' && n.includes(e)) return true
  }
  return false
}

function isBodyKey(key: string): boolean {
  const n = normaliseKey(key)
  if (n === '') return false
  return (BODY_KEY_FRAGMENTS as readonly string[]).includes(n)
}

/**
 * Whether `key` is one the caller marked as a verbatim structural identifier.
 * Exact match on the normalised form (unlike the substring rules), because a
 * preserve entry is a precise carve-out, not a broad category — `trace_id`
 * exempts `trace_id`, never `trace_id_secret`.
 */
function isPreservedKey(key: string, preserve: readonly string[]): boolean {
  if (preserve.length === 0) return false
  const n = normaliseKey(key)
  if (n === '') return false
  for (const raw of preserve) {
    if (normaliseKey(raw) === n) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// String detectors
// ---------------------------------------------------------------------------

/** A JWT — three base64url segments. Matched before the generic blob rule so
 * the marker names the shape. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]+)?/g

/** `Bearer <blob>` / `Basic <blob>` / … — the credential half of an
 * `Authorization` header value that arrived as free text (a log line, an error
 * message) rather than as a header object entry. */
const AUTH_SCHEME_RE = /\b(Bearer|Basic|Digest|Token|ApiKey)\s+[A-Za-z0-9._~+/=-]{6,}/gi

/** An http(s) / ws(s) URL. Stops at whitespace and the quoting characters that
 * realistically bound a URL inside a log line or a JSON string. */
const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>`\\)\]}]+/gi

/** A `file://` URL — handled by the path rules, not the URL rule, so a stack
 * frame keeps its structure. */
const FILE_URL_HOME_RE = /(file:\/\/)(\/home\/|\/Users\/)[^/\s"'<>`\\]+/gi

/** Platform home-directory shapes. The `<user>` segment is the PII; everything
 * below it is the debuggable part of a stack trace. */
const POSIX_HOME_RE = /(?:\/home|\/Users)\/[^/\s"'<>`\\:]+/g
const WINDOWS_HOME_RE = /[A-Za-z]:\\Users\\[^\\/\s"'<>`]+/g

/**
 * An e-mail address. Every quantifier is BOUNDED and the label class excludes
 * `.` on purpose: the obvious `[A-Za-z0-9.-]+\.[A-Za-z]{2,}` overlaps its own
 * classes, and on a long non-matching tail (a minified stack, a base64 blob —
 * both routine in a crash payload) that costs seconds of backtracking on the
 * main process. This form is linear.
 */
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}/g

/** An IPv4 literal — a LAN address identifies a network topology, a public one
 * identifies a person. */
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

/**
 * Catch-all for a high-entropy credential with no recognisable framing: 32+
 * characters of unbroken base64url/hex. Long enough that ordinary prose,
 * identifiers and stack-frame symbols don't reach it, short enough to catch a
 * typical API key or session id. This is the rule that makes the scrubber
 * fail-closed against key formats nobody modelled.
 */
const LONG_BLOB_RE = /\b[A-Za-z0-9_-]{32,}\b/g

/** Every marker this module emits — used to keep the detectors from firing on
 * their own output (which would make scrub-then-assert throw). */
const MARKERS = new Set<string>([
  REDACTED, REDACTED_URL, REDACTED_EMAIL, REDACTED_IP,
  REDACTED_TOKEN, REDACTED_BODY, REDACTED_DEPTH, REDACTED_CIRCULAR
])

function isMarker(value: string): boolean {
  return MARKERS.has(value)
}

/**
 * Sentinel wrapper used to park a rewritten URL while the remaining rules run.
 *
 * Under `urlPolicy: 'host'` the URL rule emits `scheme://host`, which the LATER
 * rules would then chew on: `https://192.168.1.1` becomes
 * `https://[redacted-ip]`, and a 32+ character DNS label becomes
 * `https://[redacted-token].example.com`. Both are mangled beyond what
 * `hostOnly` can reproduce, so re-scanning the output reports a violation and
 * scrub-then-assert throws on a payload that was in fact scrubbed.
 *
 * `U+0000` appears in none of the rule character classes, and a parked token
 * carries no `@`, no dotted quad and no 32-character run, so it is inert to
 * every remaining rule. The sentinels are swapped back at the end of the pass.
 */
const SENTINEL = '\u0000'

/**
 * Rewrite every http(s) / ws(s) URL per `policy` and park the results behind
 * sentinels. Returns the parked text plus the replacements, to be restored by
 * {@link unparkUrls} once the other rules have run.
 */
function parkUrls(text: string, policy: UrlPolicy): { parked: string; parts: string[] } {
  const parts: string[] = []
  const parked = text.replace(URL_RE, (match) => {
    const replacement = policy === 'host' ? hostOnly(match) : REDACTED_URL
    parts.push(replacement)
    return `${SENTINEL}${String(parts.length - 1)}${SENTINEL}`
  })
  return { parked, parts }
}

function unparkUrls(text: string, parts: string[]): string {
  if (parts.length === 0) return text
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => parts[Number(index)] ?? REDACTED_URL)
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hostOnly(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.protocol}//${url.host}`
  } catch {
    return REDACTED_URL
  }
}

/**
 * Scrub a single string with every text rule, in dependency order: literal
 * secrets first (they may contain URL/e-mail shapes), then the framed
 * credentials, then URLs, then paths, then the loose PII shapes, and the
 * entropy catch-all last so it only sees what survived.
 */
export function scrubString(text: string, options: ScrubOptions = {}): string {
  if (isMarker(text)) return text
  let out = text

  for (const literal of options.redactValues ?? []) {
    if (!isUsableLiteral(literal)) continue
    out = out.replace(new RegExp(escapeRegExp(literal), 'g'), REDACTED)
  }

  out = out.replace(JWT_RE, REDACTED_TOKEN)
  out = out.replace(AUTH_SCHEME_RE, (_m, scheme: string) => `${scheme} ${REDACTED_TOKEN}`)

  // URLs are rewritten first (so nothing below sees a raw query string) but
  // PARKED (so nothing below rewrites the result). See SENTINEL.
  const { parked, parts } = parkUrls(out, options.urlPolicy ?? 'strip')
  out = parked

  const homeDir = options.homeDir
  if (homeDir !== undefined && homeDir !== '') {
    out = out.replace(new RegExp(escapeRegExp(homeDir), 'g'), '~')
  }
  out = out.replace(FILE_URL_HOME_RE, (_m, scheme: string) => `${scheme}~`)
  out = out.replace(POSIX_HOME_RE, '~')
  out = out.replace(WINDOWS_HOME_RE, '~')

  out = out.replace(EMAIL_RE, REDACTED_EMAIL)
  out = out.replace(IPV4_RE, REDACTED_IP)
  out = out.replace(LONG_BLOB_RE, REDACTED_TOKEN)
  out = unparkUrls(out, parts)

  // Length cap runs LAST — after every detector has scrubbed the head — so it
  // only trims trailing bulk (a pasted document, a huge body), never content a
  // detector would otherwise have caught. The result (head + marker) is kept
  // AT OR UNDER `cap` so re-scrubbing is a no-op: were it left over `cap`, the
  // self-consistency gate would truncate again, see a different string, and
  // flag the value as "unscrubbed".
  const cap = options.maxStringLength
  if (cap !== undefined && cap >= 0 && out.length > cap) {
    const marker = (keep: number): string => `…[+${String(out.length - keep)} chars]`
    // Reserve room for the marker within the cap. Converge `keep` to a fixpoint
    // (its marker's digit-width can change `keep`, which can change the width
    // again), then guarantee `keep + marker <= cap` — a growing dropped-count
    // must never push the result 1 char over, or the self-consistency gate
    // would re-truncate it and flag the value as "unscrubbed".
    let keep = cap
    for (let pass = 0; pass < 4; pass++) {
      const next = Math.max(0, cap - marker(keep).length)
      if (next === keep) break
      keep = next
    }
    while (keep > 0 && keep + marker(keep).length > cap) keep--
    out = `${out.slice(0, keep)}${marker(keep)}`
  }
  return out
}

/**
 * A caller-supplied literal is only usable when it is long enough to be a real
 * secret AND does not occur inside one of this module's own markers — redacting
 * a fragment of `[redacted-url]` would rewrite the scrubber's own output on every
 * pass, so scrubbing would never reach a fixed point.
 */
function isUsableLiteral(literal: string): boolean {
  if (literal.length < 4) return false
  for (const marker of MARKERS) {
    if (marker.includes(literal)) return false
  }
  return true
}

/**
 * Decide whether `text` still carries anything the scrubber would remove, and
 * name the rules that fired.
 *
 * The VERDICT is `scrubString(text) !== text` — a string is clean exactly when
 * scrubbing it is a no-op. Deriving the verdict from the rewriter (rather than
 * from a parallel set of detectors) is what makes the fail-closed contract hold
 * by construction: the two can no longer disagree, so neither a detector the
 * rewriter lacks nor a rewrite the detectors don't recognise can produce a false
 * pass or a false throw. It reduces the whole guarantee to one property —
 * `scrubString` is idempotent — which is directly testable.
 *
 * The per-rule scan below runs only to LABEL a verdict already reached, so an
 * error message can say `url` instead of "something". If the labels come up
 * empty on a string that did change, we still report a generic violation rather
 * than swallow it.
 */
function stringViolations(text: string, options: ScrubOptions): string[] {
  if (isMarker(text)) return []
  if (scrubString(text, options) === text) return []
  const rules = classifyString(text, options)
  return rules.length > 0 ? rules : ['unscrubbed']
}

/** Best-effort labelling of WHICH rules fire on `text`. Diagnostics only — see
 * {@link stringViolations} for the authoritative verdict. */
function classifyString(text: string, options: ScrubOptions): string[] {
  const rules: string[] = []
  for (const literal of options.redactValues ?? []) {
    if (isUsableLiteral(literal) && text.includes(literal)) { rules.push('literal-value'); break }
  }
  if (JWT_RE.test(text)) rules.push('jwt')
  JWT_RE.lastIndex = 0
  if (AUTH_SCHEME_RE.test(text)) rules.push('auth-scheme')
  AUTH_SCHEME_RE.lastIndex = 0
  // Under `urlPolicy: 'host'` a bare `scheme://host` IS the scrubbed form, so
  // only a URL carrying a path / query / userinfo counts.
  const urlPolicy: UrlPolicy = options.urlPolicy ?? 'strip'
  const urlMatches = text.match(URL_RE) ?? []
  const offendingUrl = urlPolicy === 'host'
    ? urlMatches.some((m) => m !== hostOnly(m))
    : urlMatches.length > 0
  if (offendingUrl) rules.push('url')
  const homeDir = options.homeDir
  if (
    (homeDir !== undefined && homeDir !== '' && text.includes(homeDir)) ||
    POSIX_HOME_RE.test(text) || WINDOWS_HOME_RE.test(text)
  ) rules.push('home-path')
  POSIX_HOME_RE.lastIndex = 0
  WINDOWS_HOME_RE.lastIndex = 0
  if (EMAIL_RE.test(text)) rules.push('email')
  EMAIL_RE.lastIndex = 0
  if (IPV4_RE.test(text)) rules.push('ip')
  IPV4_RE.lastIndex = 0
  if (LONG_BLOB_RE.test(text)) rules.push('token')
  LONG_BLOB_RE.lastIndex = 0
  return rules
}

// ---------------------------------------------------------------------------
// Structural walk
// ---------------------------------------------------------------------------

/**
 * Deep-scrub an arbitrary value. Strings are rewritten by {@link scrubString};
 * an object entry under a sensitive key collapses to {@link REDACTED} and one
 * under a body key to {@link REDACTED_BODY}, whatever its type. Numbers,
 * booleans and `null` pass through untouched (they carry no free text);
 * functions, symbols and class instances are NOT preserved — the result is a
 * plain JSON-shaped value, which is all an ingestion payload may be anyway.
 *
 * Returns `unknown` on purpose: redaction changes shapes (a body object becomes
 * a marker string), so the caller re-asserts the type it needs at the boundary
 * — an honest cast beats a generic signature that quietly lies.
 */
export function scrubPayload(value: unknown, options: ScrubOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 8
  return walk(value, options, maxDepth, 0, new WeakSet<object>())
}

function walk(
  value: unknown,
  options: ScrubOptions,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof value === 'string') return scrubString(value, options)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return value.toISOString()
  if (depth >= maxDepth) return REDACTED_DEPTH
  if (seen.has(value)) return REDACTED_CIRCULAR
  seen.add(value)
  // Errors are handled before the `toJSON` branch: we want the stack trace even
  // from an error that carries a `toJSON`, which plain serialisation would drop.
  if (value instanceof Error) {
    const walked = walkError(value, options, maxDepth, depth, seen)
    seen.delete(value)
    return walked
  }
  // A `toJSON()` object serialises to something OTHER than its own enumerable
  // keys — `new URL(...)` has none at all, yet `JSON.stringify` emits the full
  // href, query string included. Walking the keys would silently drop the value
  // AND leave the leak intact for whatever serialises the payload next, so we
  // scrub what serialisation will actually see.
  const serialisable = toJsonOf(value)
  if (serialisable !== undefined) {
    // Marked as an ancestor FIRST: a `toJSON` that returns its own object (or
    // anything reaching back to it) would otherwise recurse until the stack
    // blows, and a scrubber that crashes the main process is worse than the
    // leak it was guarding.
    const fromJson = walk(serialisable, options, maxDepth, depth + 1, seen)
    seen.delete(value)
    return fromJson
  }

  const result = Array.isArray(value)
    ? value.map((entry) => walk(entry, options, maxDepth, depth + 1, seen))
    : walkRecord(value as Record<string, unknown>, options, maxDepth, depth, seen)
  // Popped on the way out so `seen` tracks ANCESTORS, not everything visited: a
  // payload that references one `user` object from two places is a DAG, not a
  // cycle, and collapsing the second reference to `[circular]` would quietly
  // delete real data.
  seen.delete(value)
  return result
}

function walkRecord(
  record: Record<string, unknown>,
  options: ScrubOptions,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const preserve = options.preserveKeys ?? []
  for (const key of Object.keys(record)) {
    // Preserve wins over every rule below: a caller naming a key here has
    // asserted its string value is a structural identifier, not content. Scoped
    // to strings so a nested object under the same key is still walked in full.
    if (isPreservedKey(key, preserve) && typeof record[key] === 'string') { out[key] = record[key]; continue }
    if (isBodyKey(key)) { out[key] = REDACTED_BODY; continue }
    if (isSensitiveKey(key, options.redactKeys ?? [])) { out[key] = REDACTED; continue }
    out[key] = walk(record[key], options, maxDepth, depth + 1, seen)
  }
  return out
}

/**
 * Errors need BOTH halves of their surface walked.
 *
 * `message` / `stack` are own but NON-ENUMERABLE, so a plain key walk misses the
 * two fields carrying the stack trace. The attached properties are the opposite
 * problem: an HTTP client's rejection (`axios`, a `fetch` wrapper) hangs the
 * whole failed request off the error — `error.config.headers.Authorization`,
 * `error.response.data` — as ordinary enumerable keys. For an API client's crash
 * reporter that is the likeliest error shape there is, and running them through
 * the normal record rules is what redacts them.
 */
function walkError(
  error: Error,
  options: ScrubOptions,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  const out = walkRecord(error as unknown as Record<string, unknown>, options, maxDepth, depth, seen)
  out['name'] = scrubString(error.name, options)
  out['message'] = scrubString(error.message, options)
  if (typeof error.stack === 'string') out['stack'] = scrubString(error.stack, options)
  return out
}

/** The value `JSON.stringify` would use for `value`, or `undefined` when it has
 * no `toJSON`. `Date` is handled earlier and never reaches here. */
function toJsonOf(value: object): unknown {
  const candidate = (value as { toJSON?: unknown }).toJSON
  if (typeof candidate !== 'function') return undefined
  try {
    return (candidate as () => unknown).call(value)
  } catch {
    // A throwing `toJSON` is unknowable, so treat it as unsendable content.
    return REDACTED
  }
}

/**
 * Collect every rule that still fires on `value`. Empty ⇒ the value is safe to
 * send. Used by {@link assertScrubbed} and directly by tests.
 */
export function findScrubViolations(value: unknown, options: ScrubOptions = {}): ScrubViolation[] {
  const violations: ScrubViolation[] = []
  inspect(value, options, options.maxDepth ?? 8, 0, '$', new WeakSet<object>(), violations)
  return violations
}

function inspect(
  value: unknown,
  options: ScrubOptions,
  maxDepth: number,
  depth: number,
  path: string,
  seen: WeakSet<object>,
  out: ScrubViolation[]
): void {
  if (typeof value === 'string') {
    for (const rule of stringViolations(value, options)) out.push({ path, rule })
    return
  }
  if (value === null || typeof value !== 'object') return
  // Everything below mirrors `walk` case for case. Any shape `walk` treats
  // specially but `inspect` walked as a plain object would be a FAIL-OPEN gap —
  // the gate would pass a payload the scrubber never actually cleaned.
  if (value instanceof Date) return
  // Past `maxDepth` a scrubbed payload holds the marker string (checked by the
  // string branch above); a surviving OBJECT means it never went through the
  // scrubber.
  if (depth >= maxDepth) { out.push({ path, rule: 'depth' }); return }
  // Likewise a real cycle: `walk` replaces it with a marker, so an object that
  // is its own ancestor here was not scrubbed.
  if (seen.has(value)) { out.push({ path, rule: 'circular' }); return }
  seen.add(value)
  if (value instanceof Error) {
    // The RAW non-enumerable trio (checking `walkError`'s output would report
    // every Error as clean), AND the enumerable properties an HTTP client
    // attaches — `error.config.headers.Authorization` is the one that matters.
    for (const field of ['name', 'message', 'stack'] as const) {
      const text = value[field]
      if (typeof text !== 'string') continue
      for (const rule of stringViolations(text, options)) out.push({ path: `${path}.${field}`, rule })
    }
    inspectRecord(value as unknown as Record<string, unknown>, options, maxDepth, depth, path, seen, out)
    seen.delete(value)
    return
  }
  const serialisable = toJsonOf(value)
  if (serialisable !== undefined) {
    inspect(serialisable, options, maxDepth, depth + 1, path, seen, out)
    seen.delete(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => { inspect(entry, options, maxDepth, depth + 1, `${path}[${String(i)}]`, seen, out) })
    seen.delete(value)
    return
  }
  inspectRecord(value as Record<string, unknown>, options, maxDepth, depth, path, seen, out)
  seen.delete(value)
}

/** Key-by-key check of a record's own enumerable properties. Shared so an
 * `Error`'s attached properties go through exactly the rules a plain object's
 * would. */
function inspectRecord(
  record: Record<string, unknown>,
  options: ScrubOptions,
  maxDepth: number,
  depth: number,
  path: string,
  seen: WeakSet<object>,
  out: ScrubViolation[]
): void {
  const preserve = options.preserveKeys ?? []
  for (const key of Object.keys(record)) {
    const child = record[key]
    const childPath = `${path}.${key}`
    // Mirror walkRecord: a preserved key's string value is exempt, so the gate
    // agrees the scrubbed payload is clean rather than throwing on the very
    // identifier that walkRecord deliberately kept.
    if (isPreservedKey(key, preserve) && typeof child === 'string') continue
    if (isBodyKey(key)) {
      if (child !== REDACTED_BODY) out.push({ path: childPath, rule: 'body-key' })
      continue
    }
    if (isSensitiveKey(key, options.redactKeys ?? [])) {
      if (typeof child !== 'string' || !isMarker(child)) out.push({ path: childPath, rule: 'sensitive-key' })
      continue
    }
    inspect(child, options, maxDepth, depth + 1, childPath, seen, out)
  }
}

/**
 * Fail-closed gate: throw {@link PayloadNotScrubbedError} unless `value` is
 * already clean. Call it as the LAST step of every send path — after the
 * transport has built its final payload — so no future transform can reintroduce
 * a secret between scrubbing and the wire.
 */
export function assertScrubbed(value: unknown, options: ScrubOptions = {}): void {
  const violations = findScrubViolations(value, options)
  if (violations.length > 0) throw new PayloadNotScrubbedError(violations)
}
