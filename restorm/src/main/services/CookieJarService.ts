/**
 * Cookie Jar Service
 *
 * A real cookie engine (tough-cookie) replacing the previous
 * origin→name→value map. One `CookieJar` PER ENVIRONMENT so two
 * environments pointing at the same host never share cookies — switching
 * the active environment switches the cookie context. tough-cookie
 * honours Domain/Path/Expires/Max-Age/Secure/HttpOnly/SameSite, so an
 * expired cookie ages out, a Path-scoped cookie only rides its path, and
 * a Domain cookie reaches its sub-domains.
 *
 * Process-lifetime scoped, never persisted to disk, cleared when a new
 * collection opens (same posture as before — no credentials on disk).
 *
 * Values are stored verbatim: a captured `Set-Cookie` is literal, while a
 * user-authored cookie may embed `{{var}}` — the caller resolves those
 * against the active environment at send time (the jar stays dumb).
 */

import { Cookie, CookieJar } from 'tough-cookie'
import { logger } from 'electron-core-ui/main'
import type { CookieInput, CookieRow } from '../../shared/cookies/cookieTypes'

export type { CookieInput, CookieRow }

/** Synthesize an https URL for a domain so tough-cookie can scope a
 * user-added cookie (Secure cookies need an https context). */
function urlForDomain(domain: string, path: string, secure: boolean): string {
  const host = domain.replace(/^\./, '')
  return `${secure ? 'https' : 'http'}://${host}${path.startsWith('/') ? path : `/${path}`}`
}

class CookieJarService {
  /** environmentId (or a stable fallback) → jar. */
  private jars = new Map<string, CookieJar>()

  private jarFor(envKey: string): CookieJar {
    let jar = this.jars.get(envKey)
    if (jar === undefined) {
      // allowSpecialUseDomain lets `localhost` cookies work; public-suffix
      // rejection stays on (a cookie can't claim `Domain=.com`).
      jar = new CookieJar(undefined, { allowSpecialUseDomain: true })
      this.jars.set(envKey, jar)
    }
    return jar
  }

  /**
   * Attach the stored cookies for `url` to `headers` as a `Cookie` header.
   * A user-supplied `Cookie` header wins (left untouched). Returns the
   * Cookie string it set (or undefined) so the caller can resolve any
   * `{{var}}` in it against the active environment.
   */
  applyCookies(envKey: string, url: string, headers: Record<string, string>): string | undefined {
    const hasCookie = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')
    if (hasCookie) return undefined
    let cookieString = ''
    try {
      cookieString = this.jarFor(envKey).getCookieStringSync(url)
    } catch (err) {
      logger.warn('[CookieJarService] getCookieString failed', { url, error: String(err) })
      return undefined
    }
    if (cookieString === '') return undefined
    headers['Cookie'] = cookieString
    return cookieString
  }

  /** Store `Set-Cookie` values from a response into the environment's jar. */
  storeCookies(envKey: string, url: string, setCookie: string | string[] | undefined): void {
    if (setCookie === undefined) return
    const values = Array.isArray(setCookie) ? setCookie : [setCookie]
    const jar = this.jarFor(envKey)
    for (const raw of values) {
      try {
        jar.setCookieSync(raw, url, { ignoreError: true })
      } catch (err) {
        logger.warn('[CookieJarService] setCookie failed', { url, error: String(err) })
      }
    }
  }

  /** Every cookie in the environment's jar, flattened for the UI. */
  list(envKey: string): CookieRow[] {
    const jar = this.jars.get(envKey)
    if (jar === undefined) return []
    let serialized: ReturnType<CookieJar['serializeSync']>
    try {
      serialized = jar.serializeSync()
    } catch {
      return []
    }
    const cookies = serialized?.cookies ?? []
    return cookies.map((c) => ({
      key: c.key ?? '',
      value: c.value ?? '',
      domain: c.domain ?? '',
      path: c.path ?? '/',
      expires: typeof c.expires === 'string' && c.expires !== 'Infinity' ? c.expires : null,
      secure: c.secure === true,
      httpOnly: c.httpOnly === true,
      sameSite: typeof c.sameSite === 'string' ? c.sameSite : null,
      hostOnly: c.hostOnly === true
    }))
  }

  /** Add / overwrite a user-authored cookie (value may contain `{{var}}`). */
  addCookie(envKey: string, input: CookieInput): void {
    const path = input.path !== undefined && input.path !== '' ? input.path : '/'
    const secure = input.secure === true
    const cookie = new Cookie({
      key: input.key,
      value: input.value,
      domain: input.domain.replace(/^\./, ''),
      path,
      secure,
      httpOnly: input.httpOnly === true,
      ...(input.expires !== undefined && input.expires !== '' ? { expires: new Date(input.expires) } : {}),
      ...(input.sameSite !== undefined && input.sameSite !== '' ? { sameSite: input.sameSite } : {}),
      hostOnly: !input.domain.startsWith('.')
    })
    try {
      this.jarFor(envKey).setCookieSync(cookie, urlForDomain(input.domain, path, secure), { ignoreError: true })
    } catch (err) {
      logger.warn('[CookieJarService] addCookie failed', { key: input.key, error: String(err) })
    }
  }

  /** Remove one cookie (domain + path + name). */
  removeCookie(envKey: string, domain: string, path: string, key: string): void {
    this.rebuildFiltered(envKey, (c) => !(c.domain === domain && c.path === path && c.key === key))
  }

  /** Remove every cookie for a domain (the Cookie Manager's "clear origin"). */
  clearDomain(envKey: string, domain: string): void {
    this.rebuildFiltered(envKey, (c) => c.domain !== domain)
  }

  /** Rebuild an environment's jar keeping only the cookies that pass
   * `keep` — a type-safe removal path (tough-cookie's per-cookie store
   * removal isn't in its public sync typings). */
  private rebuildFiltered(envKey: string, keep: (c: { domain?: string | null; path?: string | null; key?: string }) => boolean): void {
    const jar = this.jars.get(envKey)
    if (jar === undefined) return
    try {
      const serialized = jar.serializeSync()
      const cookies = serialized.cookies.filter(keep)
      this.jars.set(envKey, CookieJar.deserializeSync({ ...serialized, cookies }))
    } catch (err) {
      logger.warn('[CookieJarService] rebuildFiltered failed', { envKey, error: String(err) })
    }
  }

  /** Clear one environment's jar, or (no arg) every jar. */
  clear(envKey?: string): void {
    if (envKey === undefined) this.jars.clear()
    else this.jars.delete(envKey)
  }
}

export const cookieJarService = new CookieJarService()
