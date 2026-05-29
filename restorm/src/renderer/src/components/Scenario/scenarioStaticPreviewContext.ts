import { createContext, useContext } from 'react'

/**
 * Lets a JSON-path picker reach the editor's live static preview for a source
 * box — i.e. the config-derived output of `STATIC_PREVIEW_KINDS` (input,
 * getVariable, now, transform, arithmetic, …). The editor owns the nodes +
 * edges so it provides the lookup; the picker falls back to a runtime fetch
 * only when this returns `null` (the source kind isn't statically previewable).
 */
/** For an object-builder node, one of its properties whose value comes from
 * an upstream wire — the inspector uses this to fetch the source's run result
 * and inject the real value (instead of the static-preview `<wired>` marker
 * which can't be computed without a run). */
export interface ObjectWiredProperty {
  name: string
  sourceNodeId: string
  selector?: string | undefined
}

export interface ScenarioStaticPreviewApi {
  /** Static preview for the source node, or `null` when the kind isn't a
   * static-preview kind (the picker should then fall back to a run result). */
  getPreview: (sourceNodeId: string) => Record<string, unknown> | null
  /** Wired (non-static-source) properties of an `object` node — the inspector
   * fetches each one's run result and injects the real value into the
   * assembled preview. Returns an empty array for non-object kinds. */
  getObjectWiredProperties: (objectNodeId: string) => ObjectWiredProperty[]
  /** A representative item from a list-operating box's (`map` / `filter` /
   * `aggregate`) resolved `items` array — used by the per-item expression
   * editor to populate Ctrl+Space variables with the item's keys. Returns
   * `null` when the items aren't statically resolvable or the items aren't
   * objects (primitives have no named keys). */
  getListItemShape: (listNodeId: string) => Record<string, unknown> | null
  /** For a `runScenario` node, statically resolve each Output node of the
   * bound sub-scenario into `{ <outputName>: <value> }`. A sub-scenario
   * Output node's value comes from its `value` input — recurses into the
   * sub-scenario's own static-preview machinery. Sources without a static
   * preview yield `null` for that key (placeholder; the user can run the box
   * to see actuals). Returns `null` when the sub-scenario can't be resolved
   * (missing, broken reference). */
  getRunScenarioOutputs: (runScenarioNodeId: string) => Record<string, unknown> | null
}

export const ScenarioStaticPreviewContext = createContext<ScenarioStaticPreviewApi | null>(null)

export function useScenarioStaticPreview(): ScenarioStaticPreviewApi | null {
  return useContext(ScenarioStaticPreviewContext)
}
