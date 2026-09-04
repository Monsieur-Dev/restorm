/**
 * Main-process installer for the `code` node's external dependencies — the
 * shared, language-agnostic half of the feature. A runtime supplies a
 * {@link ArtifactFetcher} that knows how to turn a `name@version` into the bytes
 * to cache (query PyPI + download the wheel, resolve an npm tarball, …); this
 * module owns everything around it: idempotency, the concurrency lock, the
 * firewall bypass, and writing into {@link ./depsCache}.
 *
 * ## Why the fetch bypasses the app firewall
 * A dependency download is a trusted, user-initiated operation (the user pinned
 * the package), NOT sandbox traffic — so it runs under
 * {@link withFirewallBypass}, exactly like the import flow and the mini-browser,
 * and never pops a firewall prompt. This is deliberately the OPPOSITE of the
 * sandbox's own `fetch`/`pm.sendRequest` (`../codeNetworkBridge`), which stays
 * firewall-governed: user *script* network is gated, dependency *provisioning*
 * is not. (For a worker-backed runtime like Python the actual `micropip` resolve
 * runs in the worker thread, which the main-thread firewall interceptor doesn't
 * patch anyway — consistent with this.)
 *
 * ## Concurrency
 * The scheduler runs nodes in parallel, so two `code` nodes can ask for the same
 * package at once. A module-level `Map<key, Promise>` collapses concurrent
 * requests for one artifact onto a single in-flight download; the others await
 * it. The lock is keyed by `<lang>:<name>@<version>`, so different packages still
 * download concurrently.
 *
 * ## Offline / air-gapped provisioning
 * `RESTORM_CODE_DEPS_OFFLINE_DIR`, when set, is a pre-provisioned mirror laid out
 * like the cache itself (`<dir>/<lang>/<name>@<version>/<artifact>`). A package
 * found there is copied in with ZERO network — used for air-gapped installs and
 * for deterministic tests that must not touch a live registry.
 */
import { withFirewallBypass } from 'electron-core-ui'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_RESPONSE_BYTES } from '../../../shared/config/constants'
import { assertSafeFetchUrl, fetchFollowingSafeRedirects } from '../../utils/urlSecurity'
import { cacheKey, isCached, writeArtifact } from './depsCache'
import type { PackageSpec } from './types'

/** One artifact to cache for a package (e.g. a `.whl` file + its bytes). */
export interface FetchedArtifact {
  filename: string
  data: Uint8Array
}

/**
 * Resolves + downloads a package's artifact(s), returning the bytes to cache.
 * Runs inside the firewall bypass. MUST reject with a user-readable message when
 * the package/version can't be resolved or the only artifact is incompatible
 * with the WASM runtime (e.g. a C-extension wheel) — that message reaches the
 * node's `error` port verbatim.
 *
 * `cacheDir` (the runtime's per-language root) is handed to the fetcher too, for
 * a runtime that needs to write a SIDE artifact of its own during the fetch —
 * e.g. the npm runtime persists the raw tarball under a `packageSubDir` while
 * returning the derived `bundle.js` as the artifact this module writes at the
 * package root. A fetcher with no such need simply ignores the parameter (a
 * function of fewer parameters satisfies this type, e.g. `pythonWheelFetcher`).
 */
export type ArtifactFetcher = (spec: PackageSpec, cacheDir: string) => Promise<FetchedArtifact[]>

/** Fired once per package that actually triggers a network download (never on a
 * cache hit / offline copy) — drives the run-log "Downloading…" indicator. */
export type DownloadStartHook = (spec: PackageSpec) => void

// Collapses concurrent installs of the same artifact onto one in-flight promise.
const inflight = new Map<string, Promise<void>>()

/**
 * Ensure every spec is cached under `cacheDir` (the runtime's per-language
 * root). Cache hits are skipped entirely; misses download via `fetcher` under
 * the firewall bypass (or copy from the offline mirror). Rejects with the
 * fetcher's error message on any failure — the executor turns that into the
 * node's `error` output.
 */
export async function ensurePackagesCached(
  lang: string,
  cacheDir: string,
  specs: readonly PackageSpec[],
  fetcher: ArtifactFetcher,
  onDownloadStart?: DownloadStartHook
): Promise<void> {
  await Promise.all(specs.map((spec) => ensureOne(lang, cacheDir, spec, fetcher, onDownloadStart)))
}

function ensureOne(
  lang: string,
  cacheDir: string,
  spec: PackageSpec,
  fetcher: ArtifactFetcher,
  onDownloadStart?: DownloadStartHook
): Promise<void> {
  if (isCached(cacheDir, spec)) return Promise.resolve()
  const key = `${lang}:${cacheKey(spec)}`
  const existing = inflight.get(key)
  if (existing) return existing
  const run = (async (): Promise<void> => {
    // Re-check under the lock: a concurrent request may have finished between the
    // top-level check and acquiring this slot.
    if (isCached(cacheDir, spec)) return
    if (copyFromOfflineMirror(lang, cacheDir, spec)) return
    onDownloadStart?.(spec)
    // All of the fetcher's network inherits the bypass via AsyncLocalStorage.
    const artifacts = await withFirewallBypass(() => fetcher(spec, cacheDir))
    if (artifacts.length === 0) {
      throw new Error(`code deps: no artifact produced for ${spec.name}@${spec.version}`)
    }
    for (const a of artifacts) writeArtifact(cacheDir, spec, a.filename, a.data)
  })().finally(() => { inflight.delete(key) })
  inflight.set(key, run)
  return run
}

/** Copy a package from the `RESTORM_CODE_DEPS_OFFLINE_DIR` mirror if present.
 * Returns true when it satisfied the spec (no network needed). */
function copyFromOfflineMirror(lang: string, cacheDir: string, spec: PackageSpec): boolean {
  const mirror = process.env['RESTORM_CODE_DEPS_OFFLINE_DIR']
  if (!mirror) return false
  const src = join(mirror, lang, cacheKey(spec))
  if (!existsSync(src)) return false
  const files = readdirSync(src, { withFileTypes: true }).filter((e) => e.isFile())
  if (files.length === 0) return false
  // Read → writeArtifact keeps the atomic-cache invariant + path sanitising.
  for (const f of files) {
    writeArtifact(cacheDir, spec, f.name, new Uint8Array(readFileSync(join(src, f.name))))
  }
  return true
}

/**
 * SSRF-guarded GET for a package-registry / artifact URL — the single choke
 * point every runtime's {@link ArtifactFetcher} reaches the network through.
 *
 * These fetches run firewall-BYPASSED (a dependency download is trusted
 * provisioning, so {@link ensurePackagesCached} runs them under
 * `withFirewallBypass`), which means the firewall socket-interceptor backstop is
 * OFF. So the SSRF guard must live here: validate the target STRICTLY
 * ({@link assertSafeFetchUrl} with no `allowPrivateHosts` — a package URL is
 * never a legitimate loopback / RFC1918 / link-local / cloud-metadata host, even
 * though a registry JSON response could try to point us at one), and re-validate
 * every redirect hop the same way ({@link fetchFollowingSafeRedirects}, which
 * follows manually and re-asserts each `Location`). Applies to BOTH the registry
 * metadata URLs and the (registry-supplied, attacker-influenced) artifact URL.
 */
async function safeGet(url: string): Promise<Response> {
  assertSafeFetchUrl(url)
  return fetchFollowingSafeRedirects(url, {})
}

/**
 * Firewall-bypassing, SSRF-guarded HTTP GET returning the response body, for an
 * {@link ArtifactFetcher} to reach a package registry. Caps the body at
 * {@link MAX_RESPONSE_BYTES} and throws a readable message on a non-2xx / network
 * failure. Must be called from within {@link ensurePackagesCached}'s bypass scope
 * (the fetcher already is).
 */
export async function httpGetText(url: string): Promise<string> {
  const res = await safeGet(url)
  if (!res.ok) throw new Error(`code deps: registry request failed (${res.status}) for ${url}`)
  return res.text()
}

export async function httpGetBytes(url: string): Promise<Uint8Array> {
  const res = await safeGet(url)
  if (!res.ok) throw new Error(`code deps: download failed (${res.status}) for ${url}`)
  const tooLarge = (): Error => new Error(`code deps: artifact at ${url} exceeds the ${MAX_RESPONSE_BYTES}-byte cap`)
  // Reject an oversized artifact WITHOUT first buffering the whole body: honour
  // a declared Content-Length, then stream-cap the read so a lying/absent
  // header still can't grow the buffer past the cap in memory.
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw tooLarge()
  const body = res.body
  if (body === null) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_RESPONSE_BYTES) throw tooLarge()
    return buf
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}
