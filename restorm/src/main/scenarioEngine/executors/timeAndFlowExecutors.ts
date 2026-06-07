/**
 * Time-based + iteration executors. Notable for their interaction
 * with the scheduler: `forEach` returns a `scopeAction` so the
 * scheduler opens the per-item scopes; `wait` / `waitUntil` cooperate
 * with the AbortSignal so a Stop cleans up timers.
 */

import type { NodeExecutor } from '../types'
import { resolveConfigItems, concreteValue, strictAggregateNumber, aggregateValueLabel } from '../../../shared/utils/scenarioStaticPreview'
import { compareValues, resolveOperand } from '../conditionEval'

/** Wait node: sleep for `durationMs` (from input or config). Aborts
 * cleanly when the run is cancelled. */
/** Unit → milliseconds, mirrored from the renderer's `WaitDurationControl`
 * (`WAIT_UNIT_MS`). Kept in sync by hand: a `.tsx` can't be imported into
 * the main process. */
const WAIT_UNIT_MS: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 }

export const waitExecutor: NodeExecutor = (act, ctx) => {
  // A null duration (e.g. a variable that resolved to null wired into
  // `duration`) is not a waitable value — throw rather than silently waiting
  // the default.
  if (act.inputs['duration'] === null) throw new Error('cannot wait for a null duration')
  const cfg = ctx.node.config as { durationMs?: number; duration?: number; inputUnit?: string }
  const fromInput = act.inputs['duration']
  // A wired `duration` is typically an API cooldown expressed in
  // SECONDS (e.g. `data.cooldown.total_seconds`), so it's scaled to
  // ms by the node's `inputUnit` (default `s`). The user can pick
  // ms / s / min / h on the node's unit toggle. The config fallback
  // (`durationMs` / `duration`) is always already in ms.
  const inputUnitMs = WAIT_UNIT_MS[cfg.inputUnit ?? 's'] ?? 1000
  const ms = typeof fromInput === 'number' && fromInput > 0
    ? fromInput * inputUnitMs
    : (typeof cfg.durationMs === 'number' && cfg.durationMs > 0
      ? cfg.durationMs
      : (typeof cfg.duration === 'number' && cfg.duration > 0 ? cfg.duration : 1000))
  // Passthrough the trigger value; output port id is `out` (name "then").
  const value = act.inputs['in']
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.signal.removeEventListener('abort', onAbort)
      resolve({ outputs: [{ port: 'out', value }] })
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
  if (act.inputs['until'] === null) throw new Error('cannot wait until a null time')
  const target = act.inputs['until']
  let untilMs: number
  if (typeof target === 'number') untilMs = target
  else if (typeof target === 'string') untilMs = new Date(target).getTime()
  else untilMs = Date.now()
  const ms = Math.max(0, untilMs - Date.now())
  const value = act.inputs['in']
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.signal.removeEventListener('abort', onAbort)
      resolve({ outputs: [{ port: 'out', value }] })
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    }
    if (ctx.signal.aborted) onAbort()
    else ctx.signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Upper bound on the number of iterations a `for` range expands to —
 * a guard against `from`/`to`/`step` that would otherwise materialise a
 * gigantic array (the scheduler's own activation cap is a second net). */
const FOR_MAX_ITERATIONS = 100_000

/** Build the numeric range like a C `for`: `i = from; while (i <op> to) { …;
 * i += step }`. The user picks the operator (`<` `≤` `=` `≥` `>` `≠`); the step
 * is signed as given (`step` 0 → 1 to avoid a stuck loop). Bounded by
 * {@link FOR_MAX_ITERATIONS} against a non-terminating operator/step combo. */
function buildRange(from: number, to: number, step: number, op: string): number[] {
  const out: number[] = []
  if (!Number.isFinite(from) || !Number.isFinite(to)) return out
  const s = Number.isFinite(step) && step !== 0 ? step : 1
  for (let i = from; compareValues(op, i, to) && out.length < FOR_MAX_ITERATIONS; i += s) out.push(i)
  return out
}

/** For node: a numeric-range forEach. Builds the range [from..to] step
 * `step` (inputs win over config) and hands it to the same scope
 * machinery as `forEach` — `each` carries the current number, `done`
 * fires when every iteration's scope has closed. Parallelism behaves
 * exactly as on `forEach` (bounded sliding window). */
export const forExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { from?: unknown; to?: unknown; step?: unknown; operator?: unknown; parallelism?: { enabled?: boolean; count?: number } }
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback))
  // Config bounds are persisted as typed values (`{ type:'numeric', value }`),
  // so resolve them through `concreteValue` before coercing — a raw number
  // (legacy / wired) passes through unchanged. Wired input ports win.
  const from = num(act.inputs['from'], num(concreteValue(cfg.from), 0))
  const to = num(act.inputs['to'], num(concreteValue(cfg.to), 0))
  const step = num(act.inputs['step'], num(concreteValue(cfg.step), 1))
  // Loop-condition operator (`i <op> to`), user-selectable, default `<`.
  const op = typeof cfg.operator === 'string' ? cfg.operator : '<'
  const items = buildRange(from, to, step, op)
  const par = cfg.parallelism
  const batchSize = par?.enabled === true ? Math.max(1, Math.floor(par.count ?? 1)) : 1
  return {
    outputs: [],
    scopeAction: { type: 'openForEach', items, parallel: batchSize > 1, batchSize }
  }
}

/** ForEach node: opens a scope per item; the scheduler handles the
 * fan-out + the `done` port on scope close. */
export const forEachExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { parallelism?: { enabled?: boolean; count?: number } }
  // Wired `items` win; otherwise iterate the node's CONFIGURED list
  // (a `customListMulti` / `enumList` literal) so an unwired ForEach
  // still fans out over its picked items instead of doing nothing.
  const items: unknown[] = Array.isArray(act.inputs['items'])
    ? act.inputs['items']
    : (resolveConfigItems(ctx.node.config, ctx.variables) ?? [])
  // Bounded concurrency: N = the parallelism count (1 when parallelism
  // is off → strictly sequential batches of 1). The scheduler opens at
  // most N item-scopes at a time and slides the window forward as each
  // item's whole chain completes (its scope closes).
  const par = cfg.parallelism
  const batchSize = par?.enabled === true ? Math.max(1, Math.floor(par.count ?? 1)) : 1
  return {
    outputs: [],
    scopeAction: { type: 'openForEach', items, parallel: batchSize > 1, batchSize }
  }
}

/**
 * `retry` — opens a retry scope. The scheduler runs the body wired off
 * `attempt`, acts as that scope's ERROR BOUNDARY, and re-runs on failure per the
 * backoff policy up to `maxAttempts`. All the policy lives in config; the
 * scheduler (`runRetry`) does the orchestration.
 */
export const retryExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as {
    maxAttempts?: unknown; backoff?: unknown; delay?: unknown; delayUnit?: unknown
    factor?: unknown; maxDelay?: unknown; maxDelayUnit?: unknown
    retryOnError?: unknown; retryOnFailure?: unknown; retryOnStatus?: unknown
  }
  const toMs = (v: unknown, unit: unknown): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0
    return unit === 's' ? n * 1000 : unit === 'min' ? n * 60000 : n
  }
  // `maxAttempts` + `delay` may be wired (or an inline variable) — resolve them.
  const toNum = (v: unknown): number => (typeof v === 'number' ? v : Number.parseFloat(String(v)))
  const maxAttemptsN = toNum(resolveOperand(act.inputs['maxAttempts'], cfg.maxAttempts, ctx.variables))
  const maxAttempts = Number.isFinite(maxAttemptsN) && maxAttemptsN >= 1 ? Math.floor(maxAttemptsN) : 3
  const backoff = cfg.backoff === 'linear' || cfg.backoff === 'exponential' ? cfg.backoff : 'fixed'
  const delayResolved = toNum(resolveOperand(act.inputs['delay'], cfg.delay, ctx.variables))
  const delayMs = toMs(Number.isFinite(delayResolved) ? delayResolved : 0, cfg.delayUnit ?? 'ms')
  const factor = typeof cfg.factor === 'number' && cfg.factor > 0 ? cfg.factor : 2
  const maxDelayMs = toMs(cfg.maxDelay, cfg.maxDelayUnit ?? 'ms')
  const retryOnError = cfg.retryOnError !== false
  const retryOnFailure = cfg.retryOnFailure === true
  const retryOnStatus = Array.isArray(cfg.retryOnStatus)
    ? cfg.retryOnStatus.filter((n): n is number => typeof n === 'number')
    : typeof cfg.retryOnStatus === 'string'
      ? cfg.retryOnStatus.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
      : []
  return {
    outputs: [],
    scopeAction: { type: 'openRetry', maxAttempts, backoff, delayMs, factor, maxDelayMs, retryOnError, retryOnFailure, retryOnStatus }
  }
}

/** Timer node: fires its `tick` body on each interval — a frequency (number +
 * unit) OR a `cron` expression — bounded by an optional total duration / end
 * date. Frequency, cron, duration and endDate may be wired (or inline). Returns
 * an `openTimer` scope action the scheduler drives. */
export const timerExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { mode?: unknown; frequency?: unknown; unit?: unknown; cron?: unknown; duration?: unknown; durationUnit?: unknown; endDate?: unknown }
  const toMs = (v: number, unit: unknown): number => unit === 'min' ? v * 60000 : unit === 'h' ? v * 3600000 : unit === 'ms' ? v : v * 1000
  const num = (v: unknown): number => (typeof v === 'number' ? v : Number.parseFloat(String(v)))
  const useCron = cfg.mode === 'cron'
  const cronRaw = resolveOperand(act.inputs['cron'], cfg.cron, ctx.variables)
  const cron = useCron && typeof cronRaw === 'string' && cronRaw.trim() !== '' ? cronRaw.trim() : undefined
  const freqN = num(resolveOperand(act.inputs['frequency'], cfg.frequency, ctx.variables))
  const intervalMs = Math.max(1, toMs(Number.isFinite(freqN) && freqN > 0 ? freqN : 1, cfg.unit ?? 's'))
  const durN = num(resolveOperand(act.inputs['duration'], cfg.duration, ctx.variables))
  const durationMs = Number.isFinite(durN) && durN > 0 ? toMs(durN, cfg.durationUnit ?? 's') : undefined
  const endRaw = resolveOperand(act.inputs['endDate'], cfg.endDate, ctx.variables)
  let endDateMs: number | undefined
  if (endRaw instanceof Date) {
    const t = endRaw.getTime()
    if (Number.isFinite(t)) endDateMs = t
  } else if (typeof endRaw === 'number' || (typeof endRaw === 'string' && endRaw.trim() !== '')) {
    const t = new Date(endRaw).getTime()
    if (Number.isFinite(t)) endDateMs = t
  }
  return {
    outputs: [],
    scopeAction: {
      type: 'openTimer',
      intervalMs,
      ...(cron ? { cron } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(endDateMs !== undefined ? { endDateMs } : {})
    }
  }
}

/**
 * Aggregate node: reduces a collection to a single `result`.
 *
 * Two intakes, both reordered/ordered by the scheduler before they reach
 * here:
 *  - **scope-close streaming** — when wired to a `forEach`/`for` `done`
 *    port, the scheduler buffers one contribution per iteration (on
 *    `items`, inside the loop scope) and fires this executor ONCE at close
 *    with the contributions reordered by iteration index, plus an
 *    `__aggregate` meta describing how many iterations produced nothing.
 *  - **array reduce** — when `items` is a ready-made array (wired from a
 *    response body, config, …), it's reduced directly (no meta).
 *
 * Strict on missing contributions: if any iteration produced NOTHING on
 * `items`, the aggregate throws → routes to its `error` port (or fails the
 * run if unwired). There is no silent "partial" reduce — a sum that looks
 * right but silently dropped a failed upstream route is a trap. Tolerance is
 * the user's explicit job upstream (filter out bad items, or route a failed
 * iteration to a default value so it still contributes).
 */
export const aggregateExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { op?: 'count' | 'sum' | 'min' | 'max' | 'average' | 'join'; field?: string; separator?: string }
  const items: unknown[] = Array.isArray(act.inputs['items'])
    ? act.inputs['items']
    : (resolveConfigItems(ctx.node.config, ctx.variables) ?? [])
  const meta = act.inputs['__aggregate'] as { total: number; missingIndices: number[] } | undefined
  if (meta && meta.missingIndices.length > 0) {
    throw new Error(`aggregate: ${meta.missingIndices.length} of ${meta.total} iteration(s) produced no result (indices ${meta.missingIndices.join(', ')})`)
  }
  const op = cfg.op ?? 'count'
  const field = cfg.field
  const get = (it: unknown): unknown => (field !== undefined ? (it as Record<string, unknown> | null)?.[field] : it)
  // sum/min/max/average require numeric items — a non-numeric value (boolean,
  // object, garbage/empty string, missing `field`) THROWS to the `error` port,
  // sharing the SAME strict rule as the inspector preview (no silent coercion).
  const num = (it: unknown): number => {
    const raw = get(it)
    const n = strictAggregateNumber(raw)
    if (n === null) throw new Error(`Cannot ${op} a non-numeric value: ${aggregateValueLabel(raw)}`)
    return n
  }
  let value: unknown
  switch (op) {
    case 'count': value = items.length; break
    case 'sum': value = items.reduce<number>((s, it) => s + num(it), 0); break
    case 'min': value = items.length === 0 ? null : items.reduce<number>((m, it) => Math.min(m, num(it)), Infinity); break
    case 'max': value = items.length === 0 ? null : items.reduce<number>((m, it) => Math.max(m, num(it)), -Infinity); break
    case 'average': value = items.length === 0 ? null : items.reduce<number>((s, it) => s + num(it), 0) / items.length; break
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
