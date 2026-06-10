/**
 * Pure JWT-decode core for the scenario `jwt` node — the ONE implementation the
 * RUNTIME (`jwtExecutor`) and the INSPECTOR PREVIEW (`scenarioStaticPreview`)
 * both call, so the two can never drift (same pattern as `scenarioCast` /
 * `scenarioRegex` / `scenarioJson` / `scenarioCrypto`).
 *
 * Decode ONLY — it splits the compact `header.payload.signature` form,
 * base64url-decodes the two JSON segments and returns them parsed, plus the raw
 * signature segment. It does NOT verify the signature (that needs the signing
 * secret / public key — a future `verify` op).
 *
 * `applyJwt` THROWS on a non-string token, a token without the two dot-separated
 * segments, or a segment that isn't base64url-encoded JSON. The runtime routes
 * that to the `error` port; the preview catches it into "no result".
 */

export interface DecodedJwt {
  header: unknown
  payload: unknown
  /** The raw (still-encoded) signature segment, or '' for an unsigned token. */
  signature: string
}

/** base64url → the decoded UTF-8 string (handles the `-`/`_` alphabet + missing
 * padding, and multi-byte UTF-8 payloads). */
function base64UrlDecode(segment: string): string {
  let b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  if (pad) b64 += '='.repeat(4 - pad)
  const binary = atob(b64)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Decode a compact JWS/JWT string into `{ header, payload, signature }`.
 * `header` and `payload` are the parsed JSON objects; `signature` is the raw
 * third segment (unverified). A malformed token THROWS.
 */
export function applyJwt(value: unknown): DecodedJwt {
  if (typeof value !== 'string') throw new Error('JWT must be a string token')
  const [headerSeg, payloadSeg, signatureSeg] = value.split('.')
  if (headerSeg === undefined || payloadSeg === undefined) {
    throw new Error('Not a JWT — expected header.payload.signature segments')
  }
  const header: unknown = JSON.parse(base64UrlDecode(headerSeg))
  const payload: unknown = JSON.parse(base64UrlDecode(payloadSeg))
  return { header, payload, signature: signatureSeg ?? '' }
}
