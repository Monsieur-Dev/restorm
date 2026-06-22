import type { ScenarioNodeKind } from './types/scenario'
import { REGISTRY, SCENARIO_KINDS } from './scenarioKindRegistry'

/**
 * Per-kind capability accessors — derived from the kind registry (the single
 * source of truth). Each flag carries a documented DEFAULT in the registry's
 * `KindSpec`, so a kind only states its exceptions and the accessor here applies
 * the default. No kind list is duplicated: a new kind's traits live in one
 * registry entry and these accessors read them.
 */

/** Whether a kind carries the header input-event launch trigger (`in` port).
 * Default: every kind accepts one — including the "data-driven" nodes
 * (comparator, object, map/filter/aggregate, boolean, arithmetic, …), which
 * routinely read variables, so a trigger lets a flow say WHEN to (re)compute /
 * re-fetch a variable's current value rather than only running once their value
 * inputs resolve. Even the `output` sink keeps it, so it can be sequenced. */
export function acceptsInputEvent(kind: ScenarioNodeKind): boolean {
  return REGISTRY[kind].acceptsInputEvent !== false
}

/** Whether a kind draws the implicit `error` output port. Default: every kind
 * can fail, so it carries one. Opt-outs are sinks / pure reads / the retry
 * error-boundary (`output`, `now`, `retry`). `log` and `toast` DO carry one:
 * they render Handlebars expressions which can fail, and the executor lets that
 * error throw so the scheduler routes it to `error` rather than swallowing it. */
export function hasErrorPort(kind: ScenarioNodeKind): boolean {
  return REGISTRY[kind].hasErrorPort !== false
}

/** Whether a kind draws the implicit `done` completion output port. Default:
 * every kind signals completion so a flow can sequence what comes next. The
 * `output` sink (terminates the (sub-)scenario) and `throw` (never completes
 * normally) opt out. */
export function hasDonePort(kind: ScenarioNodeKind): boolean {
  return REGISTRY[kind].hasDonePort !== false
}

/** Whether a kind's inspector preview is derived statically from its config
 * (no run / no play needed) — the output is fully determined by the box config. */
export function hasStaticPreview(kind: ScenarioNodeKind): boolean {
  return REGISTRY[kind].staticPreview === true
}

/** The set of statically-previewable kinds (derived from {@link hasStaticPreview}). */
export const STATIC_PREVIEW_KINDS: ReadonlySet<ScenarioNodeKind> = new Set(
  SCENARIO_KINDS.filter(hasStaticPreview)
)
