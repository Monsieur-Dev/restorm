/**
 * The user's geographic position for the embedded browser.
 *
 * Chromium has no location source of its own on Linux (its network provider
 * needs a Google API key Restorm does not ship), so a page opened in a
 * mini-browser view that asks for `navigator.geolocation` gets nothing. This
 * service obtains a position for free — GeoClue over D-Bus on Linux, the
 * platform provider Chromium itself knows how to query on macOS and Windows
 * (through a hidden probe window), and an IP-based approximation as the last
 * resort — and hands it to every mini-browser view through the CDP
 * `Emulation.setGeolocationOverride`, which is what the page then reads.
 *
 * Everything hinges on the `privacy:geolocation` setting (OFF by default; the
 * renderer asks the user for consent before turning it on): ON resolves the
 * position once per app run and pushes it to every open view; OFF forgets the
 * position and clears the override on every view. A missing source (no
 * GeoClue, a denied OS prompt, no network) stays silent: no position, no error
 * shown — the page simply behaves as if the user had refused.
 *
 * Dev/e2e: `RESTORM_E2E_GEOLOCATION="lat,lng[,accuracy]"` (never honoured in a
 * packaged build) short-circuits the resolution with a fixed position.
 */

import { app, BrowserWindow, type WebContents } from 'electron'
import { logger, withFirewallBypass, getSettingsService } from 'electron-core-ui/main'

export const GEOLOCATION_SETTING_KEY = 'privacy:geolocation'
/** GeoClue accuracy level "city" — enough for a site's regional behaviour. */
const GEOCLUE_ACCURACY_CITY = 4
const GEOCLUE_TIMEOUT_MS = 12_000
const PROBE_TIMEOUT_MS = 12_000
const IP_LOOKUP_TIMEOUT_MS = 6_000
/** Fallback source: an IP-based approximation (city level), no key. */
export const IP_LOOKUP_URL = 'https://ipapi.co/json/'

export interface GeoPosition {
  latitude: number
  longitude: number
  /** Metres. */
  accuracy: number
  /** Where it came from — for the log line and the tests. */
  source: 'fixed' | 'geoclue' | 'platform' | 'ip'
}

type Resolver = () => Promise<GeoPosition | null>

/** The CDP override needs the debugger; the recording engine may own it. */
async function withDebugger(webContents: WebContents, run: (dbg: Electron.Debugger) => Promise<void>): Promise<void> {
  if (webContents.isDestroyed()) return
  const dbg = webContents.debugger
  const owned = !dbg.isAttached()
  if (owned) dbg.attach('1.3')
  try {
    await run(dbg)
  } finally {
    if (owned && dbg.isAttached()) {
      try { dbg.detach() } catch { /* the view is going away */ }
    }
  }
}

function parseFixed(raw: string | undefined): GeoPosition | null {
  if (raw === undefined || raw.trim() === '') return null
  const [lat, lng, acc] = raw.split(',').map((v) => Number(v.trim()))
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { latitude: lat, longitude: lng, accuracy: acc !== undefined && Number.isFinite(acc) ? acc : 1000, source: 'fixed' }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`${what} timed out after ${String(ms)} ms`)) }, ms)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) })
  })
}

/**
 * Linux: GeoClue 2 over the system bus. A GeoClue client lives only as long
 * as the D-Bus connection that created it, so the whole exchange (create the
 * client, set the desktop id + accuracy, start, wait for the location, read
 * it, stop) happens on ONE persistent connection — a CLI call per step would
 * lose the client between steps. The desktop agent may prompt the user the
 * first time; a refusal simply yields no position.
 */
async function resolveGeoClue(): Promise<GeoPosition | null> {
  if (process.platform !== 'linux') return null
  // The library is only needed on Linux; a missing module is a "no source".
  let dbus: typeof import('dbus-next')
  try {
    dbus = await import('dbus-next')
  } catch {
    return null
  }
  const bus = dbus.systemBus()
  try {
    const run = async (): Promise<GeoPosition | null> => {
      const service = 'org.freedesktop.GeoClue2'
      const managerObject = await bus.getProxyObject(service, '/org/freedesktop/GeoClue2/Manager')
      const manager = managerObject.getInterface('org.freedesktop.GeoClue2.Manager')
      const clientPath = await (manager['GetClient'] as () => Promise<string>)()
      const clientObject = await bus.getProxyObject(service, clientPath)
      const properties = clientObject.getInterface('org.freedesktop.DBus.Properties')
      const set = properties['Set'] as (iface: string, name: string, value: unknown) => Promise<void>
      await set('org.freedesktop.GeoClue2.Client', 'DesktopId', new dbus.Variant('s', 'restorm'))
      await set('org.freedesktop.GeoClue2.Client', 'RequestedAccuracyLevel', new dbus.Variant('u', GEOCLUE_ACCURACY_CITY))
      const client = clientObject.getInterface('org.freedesktop.GeoClue2.Client')
      const located = new Promise<string>((resolve) => {
        client.once('LocationUpdated', (_old: string, next: string) => { resolve(next) })
      })
      await (client['Start'] as () => Promise<void>)()
      try {
        const locationPath = await located
        const locationObject = await bus.getProxyObject(service, locationPath)
        const locationProps = locationObject.getInterface('org.freedesktop.DBus.Properties')
        const get = locationProps['Get'] as (iface: string, name: string) => Promise<{ value: unknown }>
        const [lat, lng, acc] = await Promise.all([
          get('org.freedesktop.GeoClue2.Location', 'Latitude'),
          get('org.freedesktop.GeoClue2.Location', 'Longitude'),
          get('org.freedesktop.GeoClue2.Location', 'Accuracy')
        ])
        return { latitude: Number(lat.value), longitude: Number(lng.value), accuracy: Math.max(1, Number(acc.value)), source: 'geoclue' }
      } finally {
        try { await (client['Stop'] as () => Promise<void>)() } catch { /* already gone */ }
      }
    }
    return await withTimeout(run(), GEOCLUE_TIMEOUT_MS, 'GeoClue')
  } finally {
    try { bus.disconnect() } catch { /* already closed */ }
  }
}

/**
 * macOS / Windows: Chromium queries the platform's location service itself
 * (CoreLocation, Windows Location) — no key needed. A hidden window runs the
 * one-line `navigator.geolocation` probe; the OS may show its own permission
 * prompt the first time, and a refusal yields no position.
 */
async function resolvePlatform(): Promise<GeoPosition | null> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return null
  const probe = new BrowserWindow({ show: false, width: 1, height: 1, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await probe.loadURL('about:blank')
    type Probe = { latitude: number; longitude: number; accuracy: number } | null
    const result = await withTimeout<Probe>(probe.webContents.executeJavaScript(`new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { timeout: ${String(PROBE_TIMEOUT_MS - 1000)}, maximumAge: 300000 }
      )
    })`, true) as Promise<Probe>, PROBE_TIMEOUT_MS, 'platform geolocation')
    if (result === null) return null
    return { ...result, accuracy: Math.max(1, result.accuracy), source: 'platform' }
  } finally {
    if (!probe.isDestroyed()) probe.destroy()
  }
}

/** Last resort on every platform: a city-level guess from the public IP. */
async function resolveIp(): Promise<GeoPosition | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, IP_LOOKUP_TIMEOUT_MS)
  try {
    const response = await withFirewallBypass(() => fetch(IP_LOOKUP_URL, { signal: controller.signal, headers: { accept: 'application/json' } }))
    if (!response.ok) return null
    const body = await response.json() as { latitude?: unknown; longitude?: unknown }
    const lat = typeof body.latitude === 'number' ? body.latitude : Number(body.latitude)
    const lng = typeof body.longitude === 'number' ? body.longitude : Number(body.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    // An IP lookup places a city, not a person: say so through the accuracy.
    return { latitude: lat, longitude: lng, accuracy: 25_000, source: 'ip' }
  } finally {
    clearTimeout(timer)
  }
}

/** The dev/e2e seed — never in a packaged build. Read at `start()`, not at
 *  module load: other services' unit tests import this module with a
 *  partial `electron` mock. */
function seededPosition(): GeoPosition | null {
  return app.isPackaged ? null : parseFixed(process.env['RESTORM_E2E_GEOLOCATION'])
}

export class GeolocationService {
  private position: GeoPosition | null = null
  private resolving: Promise<GeoPosition | null> | null = null
  private readonly views = new Set<WebContents>()
  private unsubscribe: (() => void) | null = null

  private fixed: GeoPosition | null | undefined

  constructor(
    private readonly resolvers: readonly Resolver[] = [resolveGeoClue, resolvePlatform, resolveIp],
    fixed?: GeoPosition | null
  ) {
    this.fixed = fixed
  }

  /** Follow the privacy setting: ON resolves + pushes, OFF forgets + clears. */
  start(): void {
    if (this.unsubscribe !== null) return
    this.fixed ??= seededPosition()
    if (this.fixed !== null) logger.warn('⚠️ TEST geolocation seeded — dev-only, RESTORM_E2E_GEOLOCATION is set', { source: 'fixed' })
    const settings = getSettingsService()
    this.unsubscribe = settings.onSettingChanged(GEOLOCATION_SETTING_KEY, (value) => {
      if (value === true) void this.enable()
      else void this.disable()
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  isEnabled(): boolean {
    try {
      return getSettingsService().get(GEOLOCATION_SETTING_KEY) === true
    } catch {
      return false
    }
  }

  current(): GeoPosition | null {
    return this.position
  }

  /**
   * A mini-browser view exists: remember it (until it is destroyed) and, when
   * the feature is on, hand it the position — resolving it first if needed.
   */
  track(webContents: WebContents): void {
    if (this.views.has(webContents)) return
    this.views.add(webContents)
    webContents.once('destroyed', () => { this.views.delete(webContents) })
    // The override rides the debugger attachment: a detach (the recording
    // engine stopping) drops it, and a navigation is a good moment to be sure
    // the page sees it.
    webContents.on('did-navigate', () => { void this.applyTo(webContents) })
    if (this.isEnabled()) void this.applyTo(webContents)
  }

  /** The recording engine released the debugger: the override went with it. */
  reapply(webContents: WebContents): void {
    if (this.isEnabled() && this.views.has(webContents)) void this.applyTo(webContents)
  }

  private async enable(): Promise<void> {
    const position = await this.resolve()
    if (position === null) return
    for (const view of this.views) await this.applyTo(view)
  }

  private async disable(): Promise<void> {
    this.position = null
    for (const view of this.views) {
      try {
        await withDebugger(view, async (dbg) => { await dbg.sendCommand('Emulation.clearGeolocationOverride') })
      } catch (error) {
        logger.debug('[Geolocation] clear override failed', { error: String(error) })
      }
    }
  }

  private async applyTo(webContents: WebContents): Promise<void> {
    if (!this.isEnabled()) return
    const position = this.position ?? await this.resolve()
    if (position === null || webContents.isDestroyed()) return
    try {
      await withDebugger(webContents, async (dbg) => {
        await dbg.sendCommand('Emulation.setGeolocationOverride', { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy })
      })
    } catch (error) {
      logger.debug('[Geolocation] set override failed', { error: String(error) })
    }
  }

  /** Resolve once per app run (or until the setting is turned off). */
  private resolve(): Promise<GeoPosition | null> {
    if (this.position !== null) return Promise.resolve(this.position)
    if (this.resolving !== null) return this.resolving
    this.resolving = (async () => {
      const fixed = this.fixed ?? null
      if (fixed !== null) {
        this.position = fixed
        return fixed
      }
      for (const resolver of this.resolvers) {
        try {
          const found = await resolver()
          if (found !== null) {
            this.position = found
            logger.info('[Geolocation] position resolved', { source: found.source, accuracy: found.accuracy })
            return found
          }
        } catch (error) {
          logger.debug('[Geolocation] source failed', { error: String(error) })
        }
      }
      logger.info('[Geolocation] no position source available')
      return null
    })().finally(() => { this.resolving = null })
    return this.resolving
  }
}

export const geolocationService = new GeolocationService()
