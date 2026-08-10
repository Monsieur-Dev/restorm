/**
 * Machine-readable identities for the import / refresh failures the app
 * can name.
 *
 * The import wizard shows failures straight to the user, in whatever
 * locale they run Restorm in. Main-process prose can't be translated
 * there — by the time it reaches the renderer it is an opaque English
 * string — so every failure the app can actually *enumerate* travels as
 * a code plus its parameters, and the renderer renders the sentence.
 *
 * Two transports, because the two paths have different constraints:
 *
 * - **Structured result.** A handler returning `{ success: false, … }`
 *   or `{ ok: false, … }` carries `errorCode` / `errorParams` alongside
 *   its human-readable `error`. Preferred wherever it's available: the
 *   prose stays intact for logs and for the MCP tools that hand
 *   `ImportResult.error` back to an agent.
 * - **Coded message.** A rejected IPC call loses everything but
 *   `Error.message` (Electron's structured clone drops custom
 *   properties), so `runApiUpdateApply` encodes the same triple INTO
 *   the message via `formatImportError`, and the renderer decodes it
 *   with `parseImportError`.
 *
 * What deliberately does NOT get a code: text produced outside the app
 * — a YAML parser's complaint, a filesystem `ENOENT`, a gRPC status
 * line, a server's HTTP reason phrase. Those are carried in the
 * reserved `detail` parameter and rendered in their own slot, never
 * interpolated into a translated sentence: a French sentence wrapped
 * around an English parser fragment reads worse than either half alone,
 * and dropping the fragment costs the user the one string that makes a
 * bug report actionable.
 */

/**
 * Every failure the import / refresh pipeline can name. Each entry maps
 * to a translation key rendered by the renderer's `describeImportError`,
 * and each of those keys is present in every locale.
 *
 * A runtime list rather than a bare union: the decoder validates against
 * it, and the renderer's key table is exhaustive over it, so adding a
 * failure here without giving it a sentence is a type error rather than
 * a raw code on someone's screen.
 */
export const IMPORT_ERROR_CODES = [
  /** The folder a refresh targets is no longer in the collection. */
  'folderNotFound',
  /** The folder records no source URL, so there is nothing to re-fetch. */
  'noSourceUrl',
  /** The folder carries no recognised `importSource`. */
  'noImportSource',
  /** The folder's format is a one-shot import (pasted cURL, bare URL):
   *  recognised, but with no spec behind it to fetch again. */
  'formatNotRefreshable',
  /** The source answered with a non-2xx status. */
  'httpStatus',
  /** The payload was fetched but no parser could read it. */
  'specParseFailed',
  /** Re-importing the spec failed somewhere inside the import pipeline. */
  'sourceImportFailed',
  /** The fetched spec normalises to zero operations — applying it would
   *  mark every request in the folder as removed. */
  'emptySpec',
  /** No importer recognised the source's format. */
  'formatNotDetected',
  /** A format was named but no provider handles it. */
  'unsupportedFormat',
  /** A `.restorm` project import declares a file-format version newer than
   *  this build understands — same refusal as opening it, for the same
   *  reason: a build cannot merge content whose format it postdates. */
  'projectFormatTooNew',
  /** A `.restorm` project import declares NO file-format version at its
   *  root — same refusal as the open path: every Restorm save stamps one,
   *  so its absence means the file is not a Restorm project. */
  'projectFormatMissing'
] as const

export type ImportErrorCode = typeof IMPORT_ERROR_CODES[number]

/**
 * Parameters interpolated into the translated sentence. The `detail`
 * key is RESERVED: it holds untranslatable upstream text and is
 * rendered in its own slot rather than inside the sentence.
 */
export type ImportErrorParams = Record<string, string>

/** Parameter name reserved for raw, untranslatable upstream text. */
export const IMPORT_ERROR_DETAIL_PARAM = 'detail'

export interface ImportErrorDescriptor {
  code: ImportErrorCode
  params: ImportErrorParams
}

/**
 * Prefix marking a message as a coded import error rather than prose.
 * Chosen to be unmistakable: no upstream library produces a message
 * starting with it, so a false decode is not a realistic failure mode.
 */
const CODED_MESSAGE_PREFIX = 'RESTORM_IMPORT_ERR:'

const KNOWN_CODES: ReadonlySet<string> = new Set<string>(IMPORT_ERROR_CODES)

/**
 * Encode a named failure into an `Error.message` that survives the
 * main → renderer IPC hop. Readable enough in a log to identify the
 * failure without decoding it (`RESTORM_IMPORT_ERR:emptySpec:{"url":…}`).
 */
export function formatImportError(code: ImportErrorCode, params?: ImportErrorParams): string {
  if (params === undefined || Object.keys(params).length === 0) {
    return `${CODED_MESSAGE_PREFIX}${code}`
  }
  return `${CODED_MESSAGE_PREFIX}${code}:${JSON.stringify(params)}`
}

/**
 * Decode a message produced by `formatImportError`, or `null` when
 * `message` is ordinary prose the caller should treat as raw detail.
 * Returns `null` — never throws — for a message that carries the prefix
 * but is malformed beyond it, so a corrupted payload degrades to the
 * generic "unexpected failure" frame instead of blanking the error row.
 *
 * The prefix is searched for anywhere in `message`, not just at its
 * start. A handler that REJECTS reaches the renderer through
 * `ipcRenderer.invoke`, which re-wraps the failure as
 * `Error invoking remote method '<channel>': Error: <original message>`
 * — so the code never sits at position 0 on the path that needs it
 * most. Anchoring the match would leave every rejected apply falling
 * through to the generic frame with the raw token on screen, which is
 * the exact defect this module exists to remove.
 */
export function parseImportError(message: string): ImportErrorDescriptor | null {
  const start = message.indexOf(CODED_MESSAGE_PREFIX)
  if (start === -1) return null
  const body = message.slice(start + CODED_MESSAGE_PREFIX.length)
  const separator = body.indexOf(':')
  const code = separator === -1 ? body : body.slice(0, separator)
  if (!KNOWN_CODES.has(code)) return null
  if (separator === -1) return { code: code as ImportErrorCode, params: {} }

  let decoded: unknown
  try {
    decoded = JSON.parse(body.slice(separator + 1))
  } catch {
    return { code: code as ImportErrorCode, params: {} }
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { code: code as ImportErrorCode, params: {} }
  }
  const params: ImportErrorParams = {}
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value === 'string') params[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') params[key] = String(value)
  }
  return { code: code as ImportErrorCode, params }
}
