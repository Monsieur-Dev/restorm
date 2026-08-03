import { describe, it, expect } from 'vitest'

import { formatImportError, parseImportError } from '../../src/shared/config/importErrors'

/**
 * The coded-message transport exists for one reason: a rejected IPC call
 * reaches the renderer as a bare `Error.message`, and the import wizard
 * shows import failures directly to the user in whatever locale they run
 * the app in. Main-process English can't be translated there, so a named
 * failure has to survive the hop as data.
 *
 * These tests pin both halves of that hop, plus the degradation
 * behaviour — a decode that can't recover a code must return `null` so
 * the caller falls back to "unexpected failure + raw text", never blank.
 */
describe('import error coding', () => {
  it('round-trips a code with no parameters', () => {
    expect(parseImportError(formatImportError('folderNotFound'))).toEqual({
      code: 'folderNotFound',
      params: {}
    })
  })

  it('round-trips a code with parameters', () => {
    const encoded = formatImportError('emptySpec', {
      url: 'https://api.example.com/openapi.json',
      format: 'openapi'
    })
    expect(parseImportError(encoded)).toEqual({
      code: 'emptySpec',
      params: { url: 'https://api.example.com/openapi.json', format: 'openapi' }
    })
  })

  it('round-trips upstream text through the reserved detail parameter', () => {
    // The whole point of `detail`: text the app did not write survives
    // intact, so the renderer can show it verbatim instead of trying to
    // translate a YAML parser.
    const detail = 'Nested mappings are not allowed in compact mappings at line 3, column 5'
    const parsed = parseImportError(formatImportError('specParseFailed', { url: 'https://x.test/s', detail }))
    expect(parsed?.params['detail']).toBe(detail)
  })

  it('survives a parameter value carrying the separator or JSON punctuation', () => {
    // Real values do this: a URL contains `:`, a parser message contains
    // braces and quotes. Neither may break the decode.
    const url = 'https://api.example.com:8443/v1/spec?q={"a":1}'
    const parsed = parseImportError(formatImportError('specParseFailed', { url, detail: 'unexpected ":" here' }))
    expect(parsed).toEqual({ code: 'specParseFailed', params: { url, detail: 'unexpected ":" here' } })
  })

  it('decodes through the wrapper ipcRenderer.invoke puts around a rejection', () => {
    // This is how the message ACTUALLY arrives in the renderer on the
    // apply path: `ipcRenderer.invoke` re-wraps a rejected handler's
    // error, so the code is never at position 0. Anchoring the match to
    // the start of the string leaves every named apply failure showing
    // its raw token on screen — verified against the running app, not
    // reasoned about.
    const wrapped = "Error invoking remote method 'apiUpdate:apply': Error: "
      + formatImportError('emptySpec', { url: 'http://127.0.0.1:8781/spec.json', format: 'openapi' })
    expect(parseImportError(wrapped)).toEqual({
      code: 'emptySpec',
      params: { url: 'http://127.0.0.1:8781/spec.json', format: 'openapi' }
    })
  })

  it('decodes a wrapped rejection that carries no parameters', () => {
    const wrapped = "Error invoking remote method 'apiUpdate:apply': Error: " + formatImportError('noSourceUrl')
    expect(parseImportError(wrapped)).toEqual({ code: 'noSourceUrl', params: {} })
  })

  it('reads ordinary prose as uncoded', () => {
    // Everything the app does not name — a filesystem error, a network
    // failure, a provider's own message — must decode to null so the
    // renderer keeps it as raw diagnostic detail.
    expect(parseImportError('ENOENT: no such file or directory')).toBeNull()
    expect(parseImportError('fetch failed')).toBeNull()
    expect(parseImportError('')).toBeNull()
  })

  it('rejects an unknown code rather than inventing a message for it', () => {
    // A code minted by a newer build than this renderer: falling through
    // to the generic frame is correct, rendering a raw key is not.
    expect(parseImportError('RESTORM_IMPORT_ERR:somethingNewer')).toBeNull()
    expect(parseImportError('RESTORM_IMPORT_ERR:somethingNewer:{"a":"b"}')).toBeNull()
  })

  it('keeps the code when the parameter payload is malformed', () => {
    // A truncated / corrupted payload still identifies the failure, and a
    // sentence with an unfilled placeholder beats no sentence at all.
    expect(parseImportError('RESTORM_IMPORT_ERR:emptySpec:{not json')).toEqual({
      code: 'emptySpec',
      params: {}
    })
    expect(parseImportError('RESTORM_IMPORT_ERR:emptySpec:["a"]')).toEqual({
      code: 'emptySpec',
      params: {}
    })
  })

  it('coerces non-string parameter values and drops unusable ones', () => {
    expect(parseImportError('RESTORM_IMPORT_ERR:httpStatus:{"status":503,"detail":null}')).toEqual({
      code: 'httpStatus',
      params: { status: '503' }
    })
  })

  it('encodes readably enough to identify the failure in a log', () => {
    // Nobody decodes a log line by hand; the encoding stays greppable so
    // a crash report is still triageable without this module.
    expect(formatImportError('noSourceUrl')).toBe('RESTORM_IMPORT_ERR:noSourceUrl')
    expect(formatImportError('formatNotRefreshable', { format: 'curl' }))
      .toBe('RESTORM_IMPORT_ERR:formatNotRefreshable:{"format":"curl"}')
  })
})
