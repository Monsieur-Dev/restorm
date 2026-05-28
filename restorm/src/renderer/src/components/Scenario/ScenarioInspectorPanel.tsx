import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ListView } from 'electron-core-ui/renderer'
import type { ScenarioPort } from '../../../../shared/types/collections'
import type { ScenarioNodeError } from './scenarioValidation'
import { buildScenarioPathTree } from './scenarioPathTree'
import { resolveSelectorPath } from '../../../../shared/utils/scenarioStaticPreview'

/** A wired property of an object-builder node whose value lives in an
 * upstream source's run result (not statically computable). */
export interface InspectorWiredProperty {
  name: string
  sourceNodeId: string
  selector?: string | undefined
}

/** A list-operating box (`map` / `filter` / `aggregate`) whose `items` come
 * from a non-static source — the inspector fetches that source's run result,
 * resolves the items via `selector`, and then calls `apply(items)` to compute
 * the box's preview (same logic the static path would have run with a
 * statically-resolvable array). */
export interface InspectorListOp {
  fetch: { sourceNodeId: string; selector?: string | undefined }
  apply: (items: unknown[]) => Record<string, unknown> | null
}

/** The single selected node previewed in the panel. */
export interface InspectorPreviewNode {
  id: string
  title: string
  /** Optional badge (e.g. SCENARIO icon or HTTP method) rendered before the
   * title — mirrors what the node's box header shows. */
  titleBadge?: React.ReactNode
  note?: string
  outputs: ScenarioPort[]
  /** Config-derived output for static-preview kinds (input, object, …): shown
   * directly, no run needed. Null/absent → the result comes from a run. */
  staticData?: Record<string, unknown> | null
  /** Object-builder properties whose source has no static preview — the panel
   * fetches each source's run result + applies the selector + overrides the
   * `<wired>` placeholder in the assembled preview with the real value. */
  wiredFetches?: InspectorWiredProperty[]
  /** For a list-operating box whose `items` come from a non-static source,
   * the recipe the inspector uses to fetch + transform → preview. */
  listOp?: InspectorListOp
}

export interface ScenarioInspectorPanelProps {
  scenarioId: string
  /** Flat list of every box error (with the box title), for the errors section. */
  errors: { nodeId: string; title: string; error: ScenarioNodeError }[]
  /** Distinct boxes in error — drives the section header count. */
  errorBoxCount: number
  /** Centre the canvas on a box (clicking an error row). */
  onFocusNode: (nodeId: string) => void
  /** The node to preview, or null when zero / many boxes are selected. */
  previewNode: InspectorPreviewNode | null
}

interface ScenarioRuntime {
  getScenarioNodeResult?: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
}
function scenarioRuntime(): ScenarioRuntime | undefined {
  return (window as { restorm?: { runtime?: ScenarioRuntime } }).restorm?.runtime
}

/** Pick an output's value out of the node's run result. Results are keyed by
 * output port id when a node emits several; a single-output node stores its
 * value as the whole result. */
/**
 * The scenario editor's side panel: a (visual-only) run toolbar, the workflow
 * error list, and a live preview of the single selected box — its name, note,
 * and its run-result output context rendered as a JSON tree (the exact same
 * data + tree as the JSON-path selector's picker popover). Shown only when
 * exactly one box is selected.
 */
export const ScenarioInspectorPanel: React.FC<ScenarioInspectorPanelProps> = ({ scenarioId, errors, errorBoxCount, onFocusNode, previewNode }) => {
  const { t } = useTranslation()
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const fetchToken = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)

  // The panel sizes to its content but never past the canvas — and a definite
  // pixel height is what lets the response tree's ListView scroll (a bare
  // max-height leaves the computed height `auto`, so height:100% never resolves
  // and the tree overflows instead of scrolling). So measure the natural
  // content height, clamp it to the available canvas height, and set it. A tall
  // tree then takes the remaining height and scrolls; a short one stays short.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const parent = panel?.parentElement
    if (!panel || !parent) return undefined
    const apply = (): void => {
      panel.style.height = 'auto'
      const natural = panel.scrollHeight
      const available = parent.clientHeight - 16
      panel.style.height = `${Math.min(natural, available)}px`
    }
    apply()
    // Canvas resize → recompute available height; tree expand/collapse changes
    // the row count → recompute natural height.
    const ro = new ResizeObserver(apply)
    ro.observe(parent)
    const mo = new MutationObserver(apply)
    mo.observe(panel, { childList: true, subtree: true })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [previewNode, result, errors.length])

  const previewId = previewNode?.id
  // Static-preview kinds (input, object, …) carry their output in the node
  // config — shown directly, so no run/fetch. Other kinds fetch their last run
  // result. Static data wins when present.
  const staticData = previewNode?.staticData ?? null
  const hasStatic = staticData !== null
  const wiredFetches = previewNode?.wiredFetches
  const listOp = previewNode?.listOp
  // The setState lives in the async callback (not the effect body), and a
  // generation token discards a stale fetch that resolves after the selection
  // already moved on. Three async paths:
  //  - non-static kind without staticData → fetch own run result.
  //  - static kind with `<wired>` placeholders (object, wait/waitUntil) →
  //    fetch each wired source + inject the real value.
  //  - list-op kind (map/filter/aggregate) whose items come from a non-
  //    static source → fetch the source, resolve `items` via the selector,
  //    then run the kind-specific computation (`apply`).
  useEffect(() => {
    const token = ++fetchToken.current
    void (async () => {
      let res: Record<string, unknown> | null = null
      if (previewId) {
        if (listOp) {
          try {
            const sourceResult = await scenarioRuntime()?.getScenarioNodeResult?.(scenarioId, listOp.fetch.sourceNodeId)
            if (sourceResult) {
              const items = listOp.fetch.selector ? resolveSelectorPath(sourceResult, listOp.fetch.selector) : sourceResult
              if (Array.isArray(items)) res = listOp.apply(items)
            }
          } catch { res = null }
        } else if (!hasStatic) {
          try { res = (await scenarioRuntime()?.getScenarioNodeResult?.(scenarioId, previewId)) ?? null } catch { res = null }
        } else if (wiredFetches && wiredFetches.length > 0) {
          const merged: Record<string, unknown> = { ...staticData }
          await Promise.all(wiredFetches.map(async (w) => {
            try {
              const sourceResult = await scenarioRuntime()?.getScenarioNodeResult?.(scenarioId, w.sourceNodeId)
              if (sourceResult) merged[w.name] = w.selector ? resolveSelectorPath(sourceResult, w.selector) : sourceResult
            } catch {
              // Source hasn't run yet (or fetch failed) — leave the
              // `<wired>` marker so the user knows the value is pending.
            }
          }))
          res = merged
        }
      }
      if (fetchToken.current === token) setResult(res)
    })()
  }, [scenarioId, previewId, hasStatic, staticData, wiredFetches, listOp])

  // `result` carries either a runtime fetch (non-static kinds) or the merged
  // static + wired-source overrides (object kind), so it wins when present.
  // `staticData` is the fallback when no async work is needed at all.
  const data = result ?? staticData
  const hasErrors = errors.length > 0
  const noop = (): void => { /* toolbar is visual-only — not wired yet */ }

  return (
    <div ref={panelRef} className="scn-inspector nodrag nopan" data-testid="scenario-inspector-panel">
      {/* Run toolbar — visual only for now. */}
      <div className="scn-inspector-toolbar" data-testid="scenario-inspector-toolbar">
        <Button small secondary icon="play" onClick={noop} options={{ ariaLabel: t('scenario.inspector.run', 'Run'), title: t('scenario.inspector.run', 'Run') }} data-testid="scenario-inspector-run" />
        <Button small secondary icon="debug-alt" onClick={noop} options={{ ariaLabel: t('scenario.inspector.debug', 'Debug'), title: t('scenario.inspector.debug', 'Debug') }} data-testid="scenario-inspector-debug" />
        <Button small secondary icon="debug-step-over" onClick={noop} options={{ ariaLabel: t('scenario.inspector.step', 'Step'), title: t('scenario.inspector.step', 'Step') }} data-testid="scenario-inspector-step" />
      </div>

      {hasErrors && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-errors">
            <div className="scn-inspector-section-title scn-inspector-errors-title">
              <i className="codicon codicon-error" aria-hidden="true" />
              {t('scenario.validation.panelTitle', { count: errorBoxCount, defaultValue: '{{count}} action error(s)' })}
            </div>
            {errors.map(({ nodeId, title, error }) => (
              <button
                key={`${nodeId}-${error.code}`}
                type="button"
                className="scn-error-row"
                onClick={() => { onFocusNode(nodeId) }}
                title={t('scenario.validation.focusBox', 'Focus this action')}
              >
                <span style={{ opacity: 0.8 }}>{title}</span> — {error.message}
              </button>
            ))}
          </div>
        </>
      )}

      {previewNode && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-preview">
            <div className="scn-inspector-section-title scn-inspector-preview-header">
              {previewNode.titleBadge}
              <span>{previewNode.title}</span>
            </div>
            {previewNode.note && <div className="scn-inspector-note">{previewNode.note}</div>}
            <div className="scn-inspector-info" role="note">
              <i className="codicon codicon-info" aria-hidden="true" />
              <span>{t('scenario.inspector.previewInfo', 'Example data, based on previous request results.')}</span>
            </div>
            {data === null ? (
              <div className="scn-inspector-empty">{t('scenario.inspector.notRun', 'Run the action to see its output.')}</div>
            ) : (
              <div className="scn-inspector-output">
                <div className="scn-inspector-tree">
                  <ListView items={buildScenarioPathTree(data)} selectionMode="single" selectedIds={[]} data-testid="scenario-inspector-result" />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ScenarioInspectorPanel
