/**
 * Shared main-side lifecycle for the worker-backed `code` runtimes (Python,
 * Lua, Ruby, PHP, R). A synchronous WASM interpreter would block the engine on
 * a runaway loop, so each runs in a Node worker_thread; this harness owns the
 * uniform part — spawn, inject, await result, and KILL on timeout / Stop.
 *
 * Kill is two-stage: it writes SIGINT (2) into a shared `interruptBuffer` (the
 * graceful path — Pyodide polls it and raises KeyboardInterrupt) and then hard-
 * terminates the worker shortly after, so a runtime that can't be interrupted
 * (or is wedged in a C call) still dies. Node worker_threads + SharedArrayBuffer
 * need no cross-origin isolation, so this works in-process.
 *
 * Each runtime supplies its own worker SOURCE (an `eval:true` string): it loads
 * its engine, reads `workerData.interruptBuffer`, and on each `{ code, input,
 * vars }` message posts `{ ok:true, result, logs }` or `{ ok:false, error }`.
 */
import { Worker } from 'node:worker_threads'
import type { CodeRunResult } from './types'

interface WorkerOk { ok: true; result: unknown; logs: string[] }
interface WorkerErr { ok: false; error: string; logs?: string[] }

export interface WorkerRunOptions {
  input: unknown
  variables: Record<string, unknown>
  timeoutMs: number
  signal?: AbortSignal
  /** Static config the worker needs at construction (e.g. vendored asset paths).
   * The harness adds `interruptBuffer`. */
  workerData?: Record<string, unknown>
}

export function runCodeWorker(workerSrc: string, code: string, opts: WorkerRunOptions): Promise<CodeRunResult> {
  // 1-byte SIGINT mailbox shared with the worker (graceful interrupt for engines
  // that poll it; harmless for those that don't — terminate is the backstop).
  const interruptBuffer = new Uint8Array(new SharedArrayBuffer(1))
  const worker = new Worker(workerSrc, { eval: true, workerData: { ...opts.workerData, interruptBuffer } })

  return new Promise<CodeRunResult>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      void worker.terminate()
    }
    const done = (fn: () => void): void => { if (!settled) { settled = true; cleanup(); fn() } }

    // Kill = settle with the kill reason NOW (timeout / Stop), nudge the SIGINT
    // mailbox (graceful for engines that poll it), and let `cleanup()` hard-
    // terminate the worker. Settling immediately means a runtime's own interrupt
    // error (e.g. Python's `KeyboardInterrupt`) never masks the real reason.
    const kill = (reason: string): void => {
      if (settled) return
      interruptBuffer[0] = 2 // SIGINT
      done(() => { reject(new Error(reason)); })
    }
    const timer = setTimeout(() => { kill(`code timed out after ${opts.timeoutMs}ms`) }, opts.timeoutMs)
    const onAbort = (): void => { kill('code execution aborted') }
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) { onAbort() } else { opts.signal.addEventListener('abort', onAbort) }
    }

    worker.on('message', (m: WorkerOk | WorkerErr) => {
      if (m.ok) done(() => { resolve({ result: m.result, logs: m.logs }); })
      else done(() => { reject(new Error(m.error)); })
    })
    worker.on('error', (e) => { done(() => { reject(e instanceof Error ? e : new Error(String(e))); }) })
    worker.on('exit', (codeNum) => { if (codeNum !== 0) done(() => { reject(new Error(`code worker exited (${codeNum})`)); }) })

    worker.postMessage({ code, input: opts.input, vars: opts.variables })
  })
}
