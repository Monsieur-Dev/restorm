/**
 * Pure cURL → HTTPRequest parser. Lives in `shared/` so the renderer
 * can call it directly during smart-paste detection without going
 * through main-process IPC. The implementation is deliberately
 * dependency-free (no logger, no model construction) — the caller
 * decides what to do with `null` (typically: fall back to the
 * browser's default paste handling).
 *
 * Coverage matches the existing `CurlImportService` flow: `-X` /
 * `--request`, `-H` / `--header`, `-d` / `--data` / `--data-raw` /
 * `--data-binary`, `-F` / `--form`, query-string extraction, line
 * continuations. `--data-binary @file` references are intentionally
 * not resolved — the renderer caller handles that case explicitly.
 */

import type { KeyValue } from '../models'
import type { HTTPMethod, HTTPRequestBody } from '../types/requestPrimitives'
import { createTypedKeyValue } from './createTypedKeyValue'

/** Cheap leading-token sniff. Returns true when the trimmed text looks
 * like a curl invocation (line-leading or after a backslash-continued
 * leading line). */
export function isCurlText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return trimmed.startsWith('curl ') || /\bcurl\s/.test(trimmed.split('\n')[0] ?? '')
}

/** Generate an opaque ID for the synthetic request. The smart-paste
 * caller usually overwrites this with the existing tab's id, but
 * keeping a unique seed avoids accidental collisions when the parsed
 * request flows somewhere else (tests, future direct-import path). */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`
}

export function parseCurlCommand(curlCommand: string): {
  id: string
  name: string
  type: 'http'
  method: HTTPMethod
  url: string
  headers: KeyValue[]
  params: KeyValue[]
  body?: HTTPRequestBody
  documentation: string
  tags: string[]
} | null {
  try {
    // Normalise: collapse `\<newline>` continuations (common in docs).
    const normalized = curlCommand.replace(/\\\s*\n\s*/g, ' ').trim()
    if (!normalized.startsWith('curl')) return null

    // Extract URL — the first quoted/unquoted token that *looks* like a
    // URL. Three accepted shapes:
    //   1. literal `http(s)://...` (the canonical case)
    //   2. `{{scheme}}://{{host}}/path` — one or more Handlebars
    //      placeholders before `://` (templated scheme + host)
    //   3. `{{baseUrl}}/path` — the entire URL prefix is a single
    //      variable, no `://` literal in the source text
    //
    // The two-regex layering catches `curl <flags> URL` first
    // (positional after curl + flags), then falls back to a free
    // search if the first regex didn't fire (URL buried among
    // options). The URL-token alternative `(?:https?://|\{\{)[^\s'"]+`
    // greedily grabs everything up to whitespace / quotes once the
    // prefix locks in.
    const urlToken = `(?:https?://|\\{\\{)[^\\s'"]+`
    let url = ''
    const urlPatternHead = new RegExp(`curl\\s+(?:-[^\\s]+\\s+)*['"]?(${urlToken})['"]?`)
    const urlMatchHead = urlPatternHead.exec(normalized)
    if (urlMatchHead?.[1] !== undefined) {
      url = urlMatchHead[1]
    } else {
      const urlPatternAny = new RegExp(`(['"]?)(${urlToken})\\1`)
      const urlMatchAny = urlPatternAny.exec(normalized)
      if (urlMatchAny?.[2] !== undefined) url = urlMatchAny[2]
    }
    if (url === '') return null

    // Method: `-X METHOD`, otherwise infer from `-d` presence (curl's own default).
    let method: HTTPMethod = 'GET'
    const methodMatch = /(?:-X|--request)\s+(['"]?)(\w+)\1/.exec(normalized)
    if (methodMatch?.[2] !== undefined) {
      method = methodMatch[2].toUpperCase() as HTTPMethod
    } else if (normalized.includes('-d ') || normalized.includes('--data')) {
      method = 'POST'
    }

    // Headers: `-H 'Key: Value'` or `-H "Key: Value"`. Two alternatives
    // so the inner content can hold the *other* quote character (JSON
    // bodies inside single-quoted args are common, and vice versa).
    const headers: KeyValue[] = []
    const headerRegex = /(?:-H|--header)\s+(?:'((?:[^']|\\.)*)'|"((?:[^"]|\\.)*)")/g
    let headerMatch
    while ((headerMatch = headerRegex.exec(normalized)) !== null) {
      const value = headerMatch[1] ?? headerMatch[2] ?? ''
      const colonIndex = value.indexOf(':')
      if (colonIndex > 0) {
        headers.push(createTypedKeyValue({
          key: value.substring(0, colonIndex).trim(),
          value: value.substring(colonIndex + 1).trim(),
          enabled: true
        }))
      }
    }

    // Body. Three precedence tiers, in order of "most structured wins":
    //   1. `--data-urlencode 'key=value'` (one or more) → an
    //      `x-www-form-urlencoded` body whose KeyValue rows are the
    //      parsed pairs. This is the OAuth-token-flow shape that comes
    //      out of Microsoft / Stripe / Auth0 doc snippets and matches
    //      curl's own semantics (each flag contributes a `key=value`
    //      to the body).
    //   2. `-F` / `--form` (one or more) → multipart/form-data, KV
    //      rows.
    //   3. `-d` / `--data` / `--data-raw` / `--data-binary` (single
    //      payload) → text body. The first one wins; curl actually
    //      merges multiple but a multi-`-d` cURL is rare in docs and
    //      ambiguous to translate.
    let body: HTTPRequestBody | undefined

    const urlencodeFields: KeyValue[] = []
    // `--data-urlencode` *can* appear unquoted (`--data-urlencode key=value`)
    // when the value has no spaces. Match three shapes: single-quoted,
    // double-quoted, and unquoted-up-to-whitespace.
    const urlencodeRegex = /--data-urlencode\s+(?:'((?:[^']|\\.)*)'|"((?:[^"]|\\.)*)"|([^\s'"]+))/g
    let urlencodeMatch
    while ((urlencodeMatch = urlencodeRegex.exec(normalized)) !== null) {
      const raw = urlencodeMatch[1] ?? urlencodeMatch[2] ?? urlencodeMatch[3] ?? ''
      const equalsIndex = raw.indexOf('=')
      if (equalsIndex >= 0) {
        urlencodeFields.push(createTypedKeyValue({
          key: raw.substring(0, equalsIndex).trim(),
          value: raw.substring(equalsIndex + 1).trim(),
          enabled: true
        }))
      } else if (raw !== '') {
        // Bare `--data-urlencode 'token'` has no `=` — treat as a
        // value-only field with an empty key (curl emits the value
        // URL-encoded, no `=` prefix).
        urlencodeFields.push(createTypedKeyValue({
          key: '',
          value: raw,
          enabled: true
        }))
      }
    }
    if (urlencodeFields.length > 0) {
      body = { type: 'x-www-form-urlencoded', fields: urlencodeFields }
    } else {
      const dataMatch = /(?:-d|--data|--data-raw|--data-binary)\s+(?:'((?:[^']|\\.)*)'|"((?:[^"]|\\.)*)")/.exec(normalized)
      const dataValue = dataMatch?.[1] ?? dataMatch?.[2]
      if (dataValue !== undefined) {
        const content = dataValue.replace(/\\"/g, '"').replace(/\\'/g, "'")
        body = { type: 'text', content }
      }
    }
    const formRegex = /(?:-F|--form)\s+(?:'((?:[^']|\\.)*)'|"((?:[^"]|\\.)*)")/g
    const formFields: KeyValue[] = []
    let formMatch
    while ((formMatch = formRegex.exec(normalized)) !== null) {
      const value = formMatch[1] ?? formMatch[2] ?? ''
      const equalsIndex = value.indexOf('=')
      if (equalsIndex > 0) {
        formFields.push(createTypedKeyValue({
          key: value.substring(0, equalsIndex).trim(),
          value: value.substring(equalsIndex + 1).trim(),
          enabled: true
        }))
      }
    }
    if (formFields.length > 0) body = { type: 'form-data', fields: formFields }

    // Query params come from the URL itself. WHATWG `new URL()` rejects
    // anything that isn't a real `http(s)://...` (or a registered
    // scheme), which means a Handlebars-templated URL like
    // `{{scheme}}://{{host}}/api/pet?status=available` would throw.
    // For those cases we split manually on `?` and parse the
    // query-string by hand — substring keys / values that themselves
    // contain `{{var}}` come out as plain strings, ready for the env
    // resolver to interpolate at send time.
    let canonicalUrl = url
    const params: KeyValue[] = []
    let displayPathname = '/'
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const urlObj = new URL(url)
      urlObj.searchParams.forEach((value, key) => {
        params.push(createTypedKeyValue({ key, value, enabled: true }))
      })
      // Drop the query string from the URL — the params list owns it now,
      // matching how the rest of the app stores URL + params.
      canonicalUrl = urlObj.origin + urlObj.pathname
      displayPathname = urlObj.pathname || '/'
    } else {
      // Templated URL — split on the first `?` and parse the query.
      const queryStart = url.indexOf('?')
      if (queryStart >= 0) {
        const rawQuery = url.slice(queryStart + 1)
        canonicalUrl = url.slice(0, queryStart)
        for (const pair of rawQuery.split('&')) {
          if (pair === '') continue
          const eqIdx = pair.indexOf('=')
          const rawKey = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair
          const rawValue = eqIdx >= 0 ? pair.slice(eqIdx + 1) : ''
          // Templates like `{{var}}` would round-trip through
          // `decodeURIComponent` cleanly (no `%` chars), but stay
          // defensive — fall back to the raw value if decoding throws.
          let key = rawKey
          let value = rawValue
          try { key = decodeURIComponent(rawKey) } catch { /* keep raw */ }
          try { value = decodeURIComponent(rawValue) } catch { /* keep raw */ }
          params.push(createTypedKeyValue({ key, value, enabled: true }))
        }
      }
      // Best-effort pathname for the request name: the segment after
      // the `://`'s next `/`, falling back to '/'.
      const schemeEnd = canonicalUrl.indexOf('://')
      if (schemeEnd >= 0) {
        const afterScheme = canonicalUrl.slice(schemeEnd + 3)
        const slashIdx = afterScheme.indexOf('/')
        displayPathname = slashIdx >= 0 ? afterScheme.slice(slashIdx) : '/'
      }
    }

    return {
      id: generateId('curl'),
      name: `${method} ${displayPathname}`,
      type: 'http',
      method,
      url: canonicalUrl,
      headers,
      params,
      ...(body ? { body } : {}),
      documentation: 'Imported from curl command',
      tags: ['curl-import']
    }
  } catch {
    return null
  }
}
