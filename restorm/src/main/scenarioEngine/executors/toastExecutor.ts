import { BrowserWindow } from 'electron'
import type { NodeExecutor } from '../types'
import { resolveOperand } from '../conditionEval'
import { renderHandlebars } from './pureExecutors'

export type ToastLevel = 'info' | 'success' | 'warning' | 'error'

const TOAST_LEVELS: ReadonlySet<string> = new Set<ToastLevel>(['info', 'success', 'warning', 'error'])

function resolveLevel(raw: unknown): ToastLevel {
  return typeof raw === 'string' && TOAST_LEVELS.has(raw) ? (raw as ToastLevel) : 'info'
}

/** Coerce an arbitrary resolved operand to a display string (objects → JSON). */
function asString(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw == null) return ''
  return typeof raw === 'object' ? JSON.stringify(raw) : String(raw as boolean | number)
}

/** `toast` — broadcasts a notification to the Restorm renderer via IPC.
 *
 * Reads from config / wired inputs: `title` (optional header text), `message`
 * (the body text), `level` (info / success / warning / error, default `info`)
 * and `duration` — a plain number of **seconds** before auto-dismiss. A
 * `duration` of `0` (or unset) means the toast is **not** time-limited and
 * persists until the user dismisses it. The executor converts seconds → ms for
 * the renderer toaster (`durationMs`). Fires `win.webContents.send('scenario:toast', …)`
 * on every open window so the renderer's `toasterService.push()` is triggered.
 *
 * Headless / CLI — no `BrowserWindow` instances: logs to the run-log at
 * `info` level and emits `done`.
 *
 * A failing `title` / `message` expression (a bad Handlebars template, an
 * unresolvable operand) THROWS — the scheduler routes it to the node's implicit
 * `error` port (or fails the run if nothing handles it) rather than the toast
 * silently never appearing. Resolution runs BEFORE the headless short-circuit,
 * so the failure surfaces in both windowed and headless runs.
 */
export const toastExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { title?: unknown; message?: unknown; level?: unknown; duration?: unknown }
  const nodeId = ctx.node.id

  // `title` / `message` accept any type. A wired input wins; otherwise an
  // EXPRESSION config renders Handlebars against the run's live variables (so
  // `Got {{itemCount}} items` resolves `itemCount`) — mirroring `logExecutor`
  // and the toast static preview (which compiles the same template, against `{}`
  // since a pre-run preview has no live variables). Every other type resolves
  // through `resolveOperand` (a `variable` reads its live value).
  const variablesCtx = Object.fromEntries(ctx.variables)
  const resolveText = (portId: 'title' | 'message', cfgVal: unknown): string => {
    const opCfg = cfgVal as { type?: unknown; value?: unknown } | undefined
    const resolved = act.inputs[portId] === undefined && opCfg?.type === 'expression' && typeof opCfg.value === 'string'
      ? renderHandlebars(opCfg.value, variablesCtx)
      : resolveOperand(act.inputs[portId], cfgVal, ctx.variables)
    return asString(resolved)
  }
  const message = resolveText('message', cfg.message)
  const title = resolveText('title', cfg.title)

  // `level` is a config-only segmented toggle (not a wireable port) — read it
  // straight off config; an unset / invalid value falls back to `info`.
  const level = resolveLevel(cfg.level)

  // Duration is a plain number of SECONDS. 0 (or unset / non-positive) → the
  // toast persists until dismissed (no `durationMs` sent). Otherwise convert to
  // ms for the renderer toaster.
  const rawDuration = cfg.duration
  const durationSeconds = typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : 0
  const durationMs = durationSeconds > 0 ? Math.round(durationSeconds * 1000) : undefined

  const windows = BrowserWindow.getAllWindows()

  if (windows.length === 0) {
    // Headless (CLI, MCP headless, test runner without a window) — log to the
    // run-log and continue silently. The run must not fail because there is no UI.
    const logText = title ? `${title} — ${message}` : message
    ctx.log({ level: 'info', source: 'user', nodeId, message: `[toast] ${logText}` })
    return { outputs: [] }
  }

  for (const win of windows) {
    win.webContents.send('scenario:toast', { title, message, level, durationMs, nodeId })
  }

  return { outputs: [] }
}
