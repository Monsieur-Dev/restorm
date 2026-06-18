/**
 * One-shot authentication prefetch helper used by the import wizard.
 *
 * The import modal's "Add an authentication route" flow creates an
 * ephemeral `AuthenticationRequest` that isn't yet in the collection
 * and isn't registered with ContextService. Rather than invent a
 * temporary registration dance, this helper makes the HTTP call
 * directly with the request's own fields and resolves the produced
 * headers handlebars against the JSON body.
 */

import http from 'http'
import https from 'https'
import { URL } from 'url'
import Handlebars from 'handlebars'
import { logger } from 'electron-core-ui/main'
import { MAX_RESPONSE_BYTES } from '../../shared/config/constants'

export interface AuthPrefetchInput {
  method: string
  url: string
  headers: { key: string; value: string; enabled?: boolean }[]
  body?: string
}

export interface AuthPrefetchResult {
  success: boolean
  statusCode?: number
  body?: string
  error?: string
}

export async function authPrefetchOneShot(input: AuthPrefetchInput): Promise<AuthPrefetchResult> {
  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return { success: false, error: `Invalid URL: ${input.url}` }
  }
  const client = parsed.protocol === 'https:' ? https : http
  const headers: Record<string, string> = {}
  for (const h of input.headers) {
    if (h.enabled === false) continue
    if (!h.key) continue
    headers[h.key] = h.value
  }
  if (input.body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  logger.info('[AuthPrefetch] wire-level request', {
    method: input.method,
    host: parsed.host,
    path: `${parsed.pathname}${parsed.search}`,
    headerKeys: Object.keys(headers),
    bodyLength: input.body?.length ?? 0
  })

  return new Promise((resolve) => {
    const req = client.request(
      {
        method: input.method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        let received = 0
        res.on('data', (c: Buffer) => {
          received += c.length
          if (received > MAX_RESPONSE_BYTES) {
            // Bound main-process memory on a runaway token endpoint.
            req.destroy()
            resolve({ success: false, error: `Response exceeded the ${MAX_RESPONSE_BYTES}-byte limit` })
            return
          }
          chunks.push(c)
        })
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({
            success: true,
            statusCode: res.statusCode ?? 0,
            body
          })
        })
      }
    )
    req.on('error', (err) => {
      logger.warn('[AuthPrefetch] request error', { error: String(err) })
      resolve({ success: false, error: err.message })
    })
    if (input.body) req.write(input.body)
    req.end()
  })
}

export function resolveProducedHeaders(
  producedHeaders: readonly { key: string; value: string; enabled?: boolean }[],
  rawBody: string
): Record<string, string> {
  let parsed: unknown
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    parsed = { body: rawBody }
  }
  const out: Record<string, string> = {}
  for (const kv of producedHeaders) {
    if (!kv.key) continue
    if (kv.enabled === false) continue
    const rendered = safeRender(kv.value, parsed)
    if (rendered !== '') out[kv.key] = rendered
  }
  return out
}

function safeRender(template: string, context: unknown): string {
  if (!template.includes('{{')) return template
  try {
    const compiled = Handlebars.compile(template, { noEscape: true })
    return compiled(context)
  } catch {
    return ''
  }
}
