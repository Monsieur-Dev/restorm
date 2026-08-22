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
 * Persisted per project: PERSISTENT cookies (those with an Expires) are
 * written to `<userData>/cookies/<projectId>.json` and reloaded when the
 * project reopens, so they survive an app restart the way a browser keeps
 * them. SESSION cookies (no Expires) live only in memory and are dropped on
 * restart. Jars swap wholesale on `setProject` (open / close / switch), which
 * flushes the outgoing project before loading the incoming one.
 *
 * Values are stored verbatim: a captured `Set-Cookie` is literal, while a
 * user-authored cookie may embed `{{var}}` — the caller resolves those
 * against the active environment at send time (the jar stays dumb).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

  /** Notified after every jar mutation so the main process can push a
   * `cookie:changed` to the renderer (live-refresh of the Cookie jar).
   * Injected from the IPC layer to keep this service electron-free. */
  private notifyChanged: () => void = () => {
    // No-op until the IPC layer injects a notifier via setChangeNotifier().
  }

  setChangeNotifier(fn: () => void): void {
    this.notifyChanged = fn
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  /** Base directory for the per-project cookie files (`<baseDir>/<id>.json`).
   * Injected from the main wiring (`app.getPath('userData')/cookies`) so the
   * service stays electron-free and unit tests never touch disk (null → all
   * persistence is a no-op). */
  private persistBaseDir: string | null = null
  /** The open project's id — the persistence file key; null when no project is
   * open (persistence disabled). */
  private projectId: string | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  setPersistBaseDir(dir: string): void {
    this.persistBaseDir = dir
  }

  /**
   * Swap the active jars to `projectId`'s, flushing the outgoing project's
   * persistent cookies to disk first. Called on file open (id = the project
   * uuid), close and switch (id = null / the next uuid). A reopen of the same
   * project therefore round-trips its persistent cookies through disk.
   */
  setProject(projectId: string | null): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
    this.persistNow()
    this.jars.clear()
    this.projectId = projectId
    if (projectId !== null) this.loadFromDisk(projectId)
    // Refresh any open Cookie jar panel to the new project's cookies.
    this.notifyChanged()
  }

  /** Flush pending persistent cookies immediately (e.g. on app quit). */
  flush(): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
    this.persistNow()
  }

  private persistFile(projectId: string): string | null {
    return this.persistBaseDir === null ? null : join(this.persistBaseDir, `${projectId}.json`)
  }

  /** Debounced disk write of the current project's persistent cookies. */
  private schedulePersist(): void {
    if (this.persistBaseDir === null || this.projectId === null) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persistNow() }, 400)
  }

  /** Write the current project's PERSISTENT (expiring) cookies to disk. Session
   * cookies are intentionally omitted so they don't survive a restart. */
  private persistNow(): void {
    const baseDir = this.persistBaseDir
    const projectId = this.projectId
    if (baseDir === null || projectId === null) return
    try {
      const jars: Record<string, unknown> = {}
      for (const [envKey, jar] of this.jars) {
        const serialized = jar.serializeSync()
        const cookies = serialized.cookies.filter((c) => typeof c.expires === 'string' && c.expires !== 'Infinity')
        if (cookies.length > 0) jars[envKey] = { ...serialized, cookies }
      }
      mkdirSync(baseDir, { recursive: true })
      writeFileSync(join(baseDir, `${projectId}.json`), JSON.stringify({ version: 1, jars }))
    } catch (err) {
      logger.warn('[CookieJarService] persist failed', { projectId, error: String(err) })
    }
  }

  /** Load a project's persisted cookies, pruning any that already expired. */
  private loadFromDisk(projectId: string): void {
    const file = this.persistFile(projectId)
    if (file === null || !existsSync(file)) return
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { jars?: Record<string, { cookies?: { expires?: string }[] }> }
      const now = Date.now()
      for (const [envKey, serialized] of Object.entries(parsed.jars ?? {})) {
        const cookies = (serialized.cookies ?? []).filter(
          (c) => typeof c.expires === 'string' && c.expires !== 'Infinity' && Date.parse(c.expires) > now
        )
        if (cookies.length === 0) continue
        try {
          this.jars.set(envKey, CookieJar.deserializeSync({ ...serialized, cookies } as Parameters<typeof CookieJar.deserializeSync>[0]))
        } catch (err) {
          logger.warn('[CookieJarService] load jar failed', { envKey, error: String(err) })
        }
      }
    } catch (err) {
      logger.warn('[CookieJarService] load failed', { projectId, error: String(err) })
    }
  }

  /** Broadcast the live-refresh AND schedule a debounced disk write. Every
   * mutation path funnels through here. */
  private afterMutation(): void {
    this.notifyChanged()
    this.schedulePersist()
  }

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
    this.afterMutation()
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
    this.afterMutation()
  }

  /** Remove one cookie (domain + path + name). */
  removeCookie(envKey: string, domain: string, path: string, key: string): void {
    this.rebuildFiltered(envKey, (c) => !(c.domain === domain && c.path === path && c.key === key))
    this.afterMutation()
  }

  /** Remove every cookie for a domain (the Cookie Manager's "clear origin"). */
  clearDomain(envKey: string, domain: string): void {
    this.rebuildFiltered(envKey, (c) => c.domain !== domain)
    this.afterMutation()
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

  /** Clear one environment's jar, or (no arg) every jar. A user-driven clear
   * (UI / MCP), so it persists — the emptied state is written to disk. */
  clear(envKey?: string): void {
    if (envKey === undefined) this.jars.clear()
    else this.jars.delete(envKey)
    this.afterMutation()
  }
}

export const cookieJarService = new CookieJarService()
