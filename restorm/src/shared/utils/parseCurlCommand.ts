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

    // Extract URL — the first quoted/unquoted `http(s)://...` token.
    let url = ''
    const urlPattern = /curl\s+(?:-[^\s]+\s+)*['"]?(https?:\/\/[^\s'"]+)['"]?/
    const urlMatch = urlPattern.exec(normalized)
    if (urlMatch?.[1] !== undefined) {
      url = urlMatch[1]
    } else {
      const urlPattern2 = /(['"]?)(https?:\/\/[^\s'"]+)\1/
      const urlMatch2 = urlPattern2.exec(normalized)
      if (urlMatch2?.[2] !== undefined) url = urlMatch2[2]
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

    // Body: prefer `-F` form fields when present (curl's `-F` always
    // means multipart/form-data); otherwise fall back to `-d` text.
    let body: HTTPRequestBody | undefined
    const dataMatch = /(?:-d|--data|--data-raw|--data-binary)\s+(?:'((?:[^']|\\.)*)'|"((?:[^"]|\\.)*)")/.exec(normalized)
    const dataValue = dataMatch?.[1] ?? dataMatch?.[2]
    if (dataValue !== undefined) {
      const content = dataValue.replace(/\\"/g, '"').replace(/\\'/g, "'")
      body = { type: 'text', content }
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

    // Query params come from the URL itself.
    const urlObj = new URL(url)
    const params: KeyValue[] = []
    urlObj.searchParams.forEach((value, key) => {
      params.push(createTypedKeyValue({ key, value, enabled: true }))
    })

    const pathname = urlObj.pathname || '/'
    return {
      id: generateId('curl'),
      name: `${method} ${pathname}`,
      type: 'http',
      method,
      // Drop the query string from the URL — the params list owns it now,
      // matching how the rest of the app stores URL + params.
      url: urlObj.origin + urlObj.pathname,
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
