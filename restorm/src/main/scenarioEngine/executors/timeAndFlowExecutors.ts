/**
 * Time-based + iteration executors. Notable for their interaction
 * with the scheduler: `forEach` returns a `scopeAction` so the
 * scheduler opens the per-item scopes; `wait` / `waitUntil` cooperate
 * with the AbortSignal so a Stop cleans up timers.
 */

import type { NodeExecutor } from '../types'

/** Wait node: sleep for `durationMs` (from input or config). Aborts
 * cleanly when the run is cancelled. */
export const waitExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { durationMs?: number; duration?: number }
  const fromInput = act.inputs['duration']
  const ms = typeof fromInput === 'number' && fromInput > 0
    ? fromInput
    : (typeof cfg.durationMs === 'number' && cfg.durationMs > 0
      ? cfg.durationMs
      : (typeof cfg.duration === 'number' && cfg.duration > 0 ? cfg.duration : 1000))
  const value = act.inputs['value']
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.signal.removeEventListener('abort', onAbort)
      resolve({ outputs: [{ port: 'then', value }] })
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    }
    if (ctx.signal.aborted) onAbort()
    else ctx.signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** WaitUntil node: sleep until the `until` time (ISO string or epoch
 * ms). Treats a past target as "fire immediately". */
export const waitUntilExecutor: NodeExecutor = (act, ctx) => {
  const target = act.inputs['until']
  let untilMs: number
  if (typeof target === 'number') untilMs = target
  else if (typeof target === 'string') untilMs = new Date(target).getTime()
  else untilMs = Date.now()
  const ms = Math.max(0, untilMs - Date.now())
  const value = act.inputs['value']
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.signal.removeEventListener('abort', onAbort)
      resolve({ outputs: [{ port: 'then', value }] })
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    }
    if (ctx.signal.aborted) onAbort()
    else ctx.signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** ForEach node: opens a scope per item; the scheduler handles the
 * fan-out + the `done` port on scope close. */
export const forEachExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { parallel?: boolean }
  const items: unknown[] = Array.isArray(act.inputs['items']) ? act.inputs['items'] : []
  return {
    outputs: [],
    scopeAction: { type: 'openForEach', items, parallel: cfg.parallel !== false }
  }
}

/** Aggregate node: collects items inside its forEach scope. The
 * Scheduler delivers one activation per per-item completion; the
 * executor stashes the partial in `ctx.variables` under a
 * `__aggregate__${nodeId}` key and emits the final `result` on the
 * `done` arrival.
 *
 * For the prototype, aggregate is driven by a single `done` token
 * from the upstream forEach + an `items` collection: simpler than the
 * scope-close-listener approach in the spec, but covers the AC
 * scenarios while we focus on the scheduler primitives. The
 * scope-close path is reserved for a follow-up. */
export const aggregateExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: 'count' | 'sum' | 'min' | 'max' | 'average' | 'join'; field?: string; separator?: string }
  const items: unknown[] = Array.isArray(act.inputs['items']) ? act.inputs['items'] : []
  const op = cfg.op ?? 'count'
  const field = cfg.field
  const get = (it: unknown): unknown => (field !== undefined ? (it as Record<string, unknown> | null)?.[field] : it)
  let value: unknown
  switch (op) {
    case 'count': value = items.length; break
    case 'sum': value = items.reduce<number>((s, it) => s + (Number(get(it)) || 0), 0); break
    case 'min': value = items.length === 0 ? null : items.reduce<number>((m, it) => Math.min(m, Number(get(it)) || 0), Infinity); break
    case 'max': value = items.length === 0 ? null : items.reduce<number>((m, it) => Math.max(m, Number(get(it)) || 0), -Infinity); break
    case 'average': value = items.length === 0 ? 0 : items.reduce<number>((s, it) => s + (Number(get(it)) || 0), 0) / items.length; break
    case 'join': value = items.map((it) => stringifyValue(get(it))).join(cfg.separator ?? ','); break
  }
  return { outputs: [{ port: 'result', value }] }
}

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}
