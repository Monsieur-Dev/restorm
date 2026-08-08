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
import { logger, withFirewallBypass } from 'electron-core-ui/main'
import { assertSafeFetchUrl } from '../utils/urlSecurity'
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
  // The firewall used to be the de-facto gate on this path; the bypass below
  // removes it, so the SSRF guard has to take its place. `allowPrivateHosts`
  // matches the equally-explicit user-typed URL next door in the import
  // source reader: loopback and RFC1918 are legitimate targets for a local
  // auth server, while link-local / cloud-metadata stays blocked. Checked
  // before the request is logged so a rejected target is never echoed out.
  try {
    assertSafeFetchUrl(input.url, { allowPrivateHosts: true })
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
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
    // pathname only — the query string can carry OAuth secrets
    // (client_secret / code / assertion).
    path: parsed.pathname,
    headerKeys: Object.keys(headers),
    bodyLength: input.body?.length ?? 0
  })

  // The user configured this authentication route and asked for it to run —
  // it is as explicit as clicking Send on a request tab, and the firewall
  // exists to gate traffic the user did NOT ask for. Without the bypass the
  // raw `http`/`https` call below lands on the main-process interceptor and
  // prompts (or, with no window able to answer, auto-denies), which blocks
  // the import of any API whose document sits behind a login.
  //
  // Scoped to THIS call rather than held open across the import, and it does
  // not leak: `client.request` is invoked synchronously inside the executor,
  // so it runs within the AsyncLocalStorage scope, and that scope unwinds
  // once this promise settles. The import's own document fetch opens and
  // closes its own bypass the same way — `readImportSource` is awaited before
  // `importFromContent`, so nothing downstream inherits it.
  return withFirewallBypass(() => new Promise<AuthPrefetchResult>((resolve) => {
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
  }))
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
    const rendered = safeRender(kv.value, parsed, kv.key)
    if (rendered !== '') out[kv.key] = rendered
  }
  return out
}

function safeRender(template: string, context: unknown, headerKey?: string): string {
  if (!template.includes('{{')) return template
  try {
    const compiled = Handlebars.compile(template, { noEscape: true })
    return compiled(context)
  } catch (err) {
    // Surface the failure: silently returning '' drops the produced header and
    // the auth request fails downstream with no clue why. Log the header name
    // (not the template — it can reference secrets) + the error.
    logger.warn('[AuthenticationPrefetch] produced-header template failed to render', {
      header: headerKey,
      error: err instanceof Error ? err.message : String(err)
    })
    return ''
  }
}
