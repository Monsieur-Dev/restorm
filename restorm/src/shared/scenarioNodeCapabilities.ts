import type { ScenarioNodeKind } from './types/scenario'

/**
 * Per-kind capability flags — the SINGLE source of truth for behaviours that
 * several layers must agree on, so a kind's traits are declared once here
 * instead of being duplicated (and silently drifting) across the port specs,
 * the box render flags and the preview resolvers. Each accessor encodes the
 * default, so the sets below only list the kinds that DIFFER from it.
 */

/**
 * Kinds that do NOT accept a header input-event (the `in` launch trigger).
 *
 * Default: every kind accepts one — including the "data-driven" nodes
 * (comparator, object, map/filter/aggregate, boolean, arithmetic, …), which
 * routinely read variables, so a trigger lets a flow say WHEN to (re)compute /
 * re-fetch a variable's current value rather than only running once their value
 * inputs resolve. Even the `output` sink keeps it, so it can be sequenced in a
 * flow. No kind opts out today (kept as the hook for any that should).
 */
const NO_INPUT_EVENT = new Set<ScenarioNodeKind>()

/**
 * Kinds whose inspector preview is fully derived from their config (no run / no
 * play needed) — the output is determined entirely by the box's configuration.
 */
const STATIC_PREVIEW = new Set<ScenarioNodeKind>([
  'now', 'input', 'setVariable', 'getVariable', 'object', 'output',
  'arithmetic', 'comparator', 'boolean', 'transform', 'cast',
  'if', 'switch', 'wait', 'waitUntil',
  'map', 'filter', 'aggregate',
  'addToList', 'removeFromList',
  // `while` / `doWhile` route a value to body/done exactly like `if`.
  'while', 'doWhile'
])

/**
 * Kinds that do NOT expose the implicit `error` output port. Default: every
 * kind can fail, so it carries one. Opt-outs are sinks / pure reads where an
 * error anchor is meaningless (`output`, `log`, `now`).
 */
const NO_ERROR_PORT = new Set<ScenarioNodeKind>(['output', 'log', 'now'])

/**
 * Kinds that do NOT expose the implicit `done` completion port. Default: every
 * kind signals completion so a flow can sequence what comes next. The `output`
 * sink opts out — it terminates the (sub-)scenario, there is nothing after it.
 */
const NO_DONE_PORT = new Set<ScenarioNodeKind>(['output'])

/** Whether a kind carries the header input-event launch trigger (`in` port). */
export function acceptsInputEvent(kind: ScenarioNodeKind): boolean {
  return !NO_INPUT_EVENT.has(kind)
}

/** Whether a kind draws the implicit `error` output port. */
export function hasErrorPort(kind: ScenarioNodeKind): boolean {
  return !NO_ERROR_PORT.has(kind)
}

/** Whether a kind draws the implicit `done` completion output port. */
export function hasDonePort(kind: ScenarioNodeKind): boolean {
  return !NO_DONE_PORT.has(kind)
}

/** Whether a kind's inspector preview is derived statically from its config. */
export function hasStaticPreview(kind: ScenarioNodeKind): boolean {
  return STATIC_PREVIEW.has(kind)
}

/** The set of statically-previewable kinds (derived from {@link hasStaticPreview}). */
export const STATIC_PREVIEW_KINDS: ReadonlySet<ScenarioNodeKind> = STATIC_PREVIEW
