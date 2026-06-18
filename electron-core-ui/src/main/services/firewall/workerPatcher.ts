import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodeWorkerThreads from 'node:worker_threads'
import * as nodeChildProcess from 'node:child_process'
import { app } from 'electron'
import { logger } from '../LoggerService'
import { getWorkerBootstrapPrefix } from './firewallConfig'

/**
 * Worker / child-process firewall extension. The main-process
 * `MainProcessInterceptor` only patches the http/https/fetch
 * surfaces inside the main process — every `worker_threads.Worker`
 * and `child_process.fork()` spawns a fresh V8 context that doesn't
 * inherit those patches, so a malicious dep could theoretically
 * fork a child to bypass the firewall.
 *
 * We close that gap by injecting a `--require <bootstrap>` flag
 * into the execArgv of every spawned worker / forked child. The
 * bootstrap script (a CJS file we write to `os.tmpdir()` at install
 * time) takes a hard, conservative posture: in a worker / forked
 * child, ALL outbound network traffic is denied. There's no IPC
 * channel back to the parent's `PermissionService`, and we'd rather
 * a dep that shouldn't be talking to the network at all surface
 * `EFIREWALLDENIED` than silently get a free pass.
 *
 * The host app may not spawn workers or fork children itself today,
 * so this is a defensive measure: if a future npm package starts
 * doing it, the firewall posture stays intact without anyone
 * having to remember to re-arm it.
 *
 * Idempotent — calling it twice is a no-op.
 */

let installed = false
let bootstrapPath: string | null = null

const BOOTSTRAP_CODE = String.raw`
;(function installFirewallInWorker () {
  var http, https
  try { http = require('node:http') } catch (_) {}
  try { https = require('node:https') } catch (_) {}
  var EventEmitter
  try { EventEmitter = require('node:events').EventEmitter } catch (_) { EventEmitter = require('events').EventEmitter }
  function makeDenied (target) {
    var ee = new EventEmitter()
    var destroyed = false
    setImmediate(function () {
      if (destroyed) return
      var err = new Error('Firewall: outbound traffic denied (worker / fork)')
      err.code = 'EFIREWALLDENIED'
      ee.emit('error', err)
      ee.emit('close')
    })
    ee.write = function (_chunk, _enc, cb) { if (typeof cb === 'function') setImmediate(cb); return true }
    ee.end = function (_chunk, _enc, cb) { if (typeof cb === 'function') setImmediate(cb); return ee }
    ee.destroy = function () { destroyed = true; return ee }
    ee.abort = function () { destroyed = true }
    ee.setTimeout = function () { return ee }
    ee.setNoDelay = function () { return ee }
    ee.setSocketKeepAlive = function () { return ee }
    ee.setHeader = function () { return ee }
    ee.getHeader = function () { return undefined }
    ee.removeHeader = function () {}
    ee.getHeaderNames = function () { return [] }
    ee.getHeaders = function () { return {} }
    ee.hasHeader = function () { return false }
    ee.flushHeaders = function () {}
    ee.cork = function () {}
    ee.uncork = function () {}
    return ee
  }
  function patchHttpLike (mod) {
    if (!mod) return
    var origReq = mod.request
    var origGet = mod.get
    mod.request = function () { return makeDenied() }
    mod.get = function () { return makeDenied() }
    void origReq; void origGet
  }
  patchHttpLike(http)
  patchHttpLike(https)
  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = function () {
      return Promise.reject(Object.assign(new Error('Firewall: outbound fetch denied (worker / fork)'), { code: 'EFIREWALLDENIED' }))
    }
  }
})();
`

/**
 * Write the bootstrap script to disk and return its absolute path.
 * Cached after the first call so repeated calls don't re-write.
 */
function ensureBootstrapPath(): string {
	if (bootstrapPath !== null) return bootstrapPath
	const path = join(tmpdir(), `${getWorkerBootstrapPrefix()}-${String(process.pid)}.cjs`)
	writeFileSync(path, BOOTSTRAP_CODE, 'utf8')
	bootstrapPath = path
	app.on('before-quit', () => {
		try { unlinkSync(path) } catch { /* file already gone — ignore */ }
	})
	return path
}

interface WorkerOptions {
	execArgv?: string[]
	[key: string]: unknown
}

interface ForkOptions {
	execArgv?: string[]
	[key: string]: unknown
}

export function installWorkerPatcher(): void {
	if (installed) return
	installed = true

	const path = ensureBootstrapPath()
	const requireFlag = ['--require', path]

	// Both patches are best-effort. The bundler (`electron-vite`)
	// emits the `node:worker_threads` and `node:child_process`
	// imports as ESM module namespace objects, whose properties
	// are getter-only — direct assignment throws
	// `TypeError: Cannot set property Worker of [object Module]
	// which has only a getter`. We try `Object.defineProperty`
	// with `configurable: true` first, then fall back to a logged
	// warning. When the host app doesn't spawn workers / child
	// processes itself, the defensive patch silently degrading to a
	// no-op is acceptable.
	const workerOk = patchWorkerConstructor(requireFlag)
	const forkOk = patchChildProcessFork(requireFlag)

	logger.info('FirewallService: worker / child-process patcher installed', {
		bootstrap: path,
		workerPatched: workerOk,
		forkPatched: forkOk
	})
}

function patchWorkerConstructor(requireFlag: string[]): boolean {
	const OriginalWorker = nodeWorkerThreads.Worker
	class PatchedWorker extends OriginalWorker {
		constructor(filename: string | URL, options?: WorkerOptions) {
			const merged: WorkerOptions = { ...(options ?? {}) }
			merged.execArgv = [...requireFlag, ...(merged.execArgv ?? [])]
			super(filename, merged as ConstructorParameters<typeof OriginalWorker>[1])
		}
	}
	try {
		Object.defineProperty(nodeWorkerThreads, 'Worker', {
			value: PatchedWorker,
			writable: true,
			configurable: true
		})
		return true
	} catch (err) {
		// Downgraded from warn → debug: when the host app doesn't spawn
		// workers, this patch is defensive-only. Surfacing it at WARN
		// level added noise to every startup without flagging any actual
		// problem (Electron sometimes locks `worker_threads.Worker` to
		// non-configurable). If a future feature starts spawning workers,
		// re-elevate this and re-audit the inheritance contract.
		logger.debug('FirewallService: could not patch worker_threads.Worker; spawned workers will not inherit the firewall (defensive-only when the host app does not spawn workers)', { error: String(err) })
		return false
	}
}

function patchChildProcessFork(requireFlag: string[]): boolean {
	const original = nodeChildProcess.fork
	const patched: typeof nodeChildProcess.fork = ((...args: unknown[]): ReturnType<typeof original> => {
		const [modulePath, second, third] = args
		// `fork(modulePath)` / `fork(modulePath, args)` /
		// `fork(modulePath, options)` / `fork(modulePath, args, options)`
		let argsForFork: string[] | undefined
		let options: ForkOptions | undefined
		if (Array.isArray(second)) {
			argsForFork = second
			options = (third as ForkOptions | undefined) ?? undefined
		} else if (second !== undefined && typeof second === 'object') {
			options = second as ForkOptions
		}
		const merged: ForkOptions = { ...(options ?? {}) }
		merged.execArgv = [...requireFlag, ...(merged.execArgv ?? [])]
		if (argsForFork !== undefined) {
			return original(modulePath as string, argsForFork, merged as Parameters<typeof original>[2])
		}
		return original(modulePath as string, merged as Parameters<typeof original>[2])
	}) as typeof nodeChildProcess.fork
	try {
		Object.defineProperty(nodeChildProcess, 'fork', {
			value: patched,
			writable: true,
			configurable: true
		})
		return true
	} catch (err) {
		// Same rationale as the `worker_threads` patch above — when the
		// host app doesn't fork its own children, this is defensive-only.
		// Logged at debug level to keep startup quiet; re-elevate if a
		// feature starts forking.
		logger.debug('FirewallService: could not patch child_process.fork; forked children will not inherit the firewall (defensive-only when the host app does not fork children)', { error: String(err) })
		return false
	}
}
