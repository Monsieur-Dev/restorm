import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ListView } from 'electron-core-ui/renderer'
import type { ScenarioLogEntry } from '../../hooks/useScenarioEngine'
import { ScenarioRunLogView, type LogProvenanceApi } from './ScenarioRunLogView'
import type { ScenarioPort } from '../../../../shared/types/collections'
import type { ScenarioNodeError } from './scenarioValidation'
import { buildScenarioPathTree } from './scenarioPathTree'
import { resolveSelectorPath } from '../../../../shared/utils/scenarioStaticPreview'
import type { SyntheticRequestPreview } from '../../../../shared/utils/syntheticRequestPreview'

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
  /** Whether the (visual) "running" animation is currently active on this
   * node — drives the toolbar Run button's Play↔Pause toggle. */
  fakeRunActive?: boolean
  /** Whether the box is something the renderer can ask the engine to
   * actually run (request / wait). Drives the "no recent run results"
   * fallback — when the inspector has no data to show on a runnable
   * node, it offers a play button to populate it instead of just the
   * static info-row. */
  runnable?: boolean
  /** Spec-derived synthetic preview to show when the box has no run
   * result of its own — request/response envelope built from the
   * matched operation in the env folder's `apiDocumentation`. The
   * inspector renders it like a real result, with a different info row
   * so the user knows the values are sampled from the spec. */
  syntheticPreview?: SyntheticRequestPreview
  /** When the box is bound to a navigable item (request or sub-scenario),
   * the panel renders a navigation row at the top — "Open <Name> →".
   * `openItemId` carries the id to navigate to; `openItemKind` chooses
   * the label and the badge. */
  openItemId?: string
  openItemKind?: 'request' | 'scenario'
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
  /** Run the (fake / simulated) execution animation on the previewed box.
   * Side-effect-bearing real execution lands in a later phase; for now
   * this paints a "currently running" `BorderBeam` around the node. */
  onTriggerFakeRun?: (nodeId: string) => void
  /** Sibling of `onTriggerFakeRun` — flips the same placeholder animation
   * but on the OUTGOING edges of the previewed box (a moving beam runs
   * along each bezier from the box's handles to the downstream nodes). */
  onTriggerFakeDebug?: (nodeId: string) => void
  /** Open the previewed node's bound item (request / sub-scenario) in a
   * workbench tab — drives the navigation row at the top of the panel. */
  onOpenItem?: (itemId: string) => void
  /** Phase 2 engine controls — when supplied, the toolbar Run / Pause /
   * Step / Stop buttons drive a real run instead of the fake-run
   * animation. The engine's current state (running/paused/idle) drives
   * the icon swap on the Run button. */
  engineState?: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
  onEngineRun?: () => void
  onEnginePause?: () => void
  onEngineResume?: () => void
  onEngineStep?: () => void
  onEngineStop?: () => void
  /** Chronological run log (current or last run, whole tree merged).
   * Shown in the panel body when NO box is selected. */
  runLog?: readonly ScenarioLogEntry[]
  /** Clears the displayed run log. Wired only in the live inspector — the
   * persisted run-history is read-only and offers no clear action. */
  onClearRunLog?: () => void
  /** Provenance link support for log rows that came from a sub-scenario. */
  logProvenance?: LogProvenanceApi
}

interface ScenarioRuntime {
  getScenarioNodeResult?: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
  runScenarioNode?: (scenarioId: string, nodeId: string) => Promise<unknown>
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
export const ScenarioInspectorPanel: React.FC<ScenarioInspectorPanelProps> = ({ scenarioId, errors, errorBoxCount, onFocusNode, previewNode, onTriggerFakeRun, onTriggerFakeDebug, onOpenItem, engineState, onEngineRun, onEnginePause, onEngineResume, onEngineStep, onEngineStop, runLog, onClearRunLog, logProvenance }) => {
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
  // Bumped after the inline "Run from here" button fires the engine, so the
  // useEffect below re-runs and refetches the freshly-populated result.
  const [runVersion, setRunVersion] = useState(0)
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
  }, [scenarioId, previewId, hasStatic, staticData, wiredFetches, listOp, runVersion])

  // Tracks the in-flight "Run from here" call so the inline button can
  // disable + swap to a busy icon while the engine is busy.
  const [running, setRunning] = useState(false)

  // `result` carries either a runtime fetch (non-static kinds) or the merged
  // static + wired-source overrides (object kind), so it wins when present.
  // `staticData` is the fallback when no async work is needed at all.
  // `syntheticPreview` is the spec-derived envelope shown when neither
  // is available on a runnable box.
  const realData = result ?? staticData
  const syntheticPreview = previewNode?.syntheticPreview
  const data = realData
    ?? (syntheticPreview ? (syntheticPreview as unknown as Record<string, unknown>) : null)
  const isSynthetic = realData === null && syntheticPreview != null
  const hasErrors = errors.length > 0
  // When the host wires `onEngineRun` (Phase 2), the toolbar drives the
  // real engine: Run kicks off the scenario; Pause/Resume + Step + Stop
  // are live controls; the Run button swaps to a Pause icon while
  // running and back to Play while paused/idle. When the engine
  // controls are absent (Phase 1 host that hasn't been migrated yet),
  // the buttons fall back to the fake-run animation handlers.
  const engineWired = onEngineRun !== undefined
  const onRun = (): void => {
    if (onEngineRun !== undefined) {
      if (engineState === 'running') onEnginePause?.()
      else if (engineState === 'paused') onEngineResume?.()
      else onEngineRun()
      return
    }
    if (previewNode && onTriggerFakeRun) onTriggerFakeRun(previewNode.id)
  }
  const onDebug = (): void => {
    if (previewNode && onTriggerFakeDebug) onTriggerFakeDebug(previewNode.id)
  }
  const onStep = (): void => {
    if (engineWired && (engineState === 'paused' || engineState === 'running')) {
      onEngineStep?.()
    }
  }
  const onStop = (): void => {
    if (engineWired) onEngineStop?.()
  }
  const runDisabled = engineWired ? false : !previewNode || !onTriggerFakeRun
  const debugDisabled = !previewNode || !onTriggerFakeDebug
  const stepDisabled = !engineWired || (engineState !== 'paused' && engineState !== 'running')
  const stopDisabled = !engineWired || (engineState !== 'running' && engineState !== 'paused')
  const runIsPause = engineWired
    ? engineState === 'running'
    : previewNode?.fakeRunActive === true
  const runIcon = runIsPause ? 'debug-pause' : 'play'
  const runLabel = runIsPause
    ? t('scenario.inspector.pause', 'Pause')
    : t('scenario.inspector.run', 'Run')
  const debugLabel = t('scenario.inspector.debug', 'Debug')
  const stopLabel = t('scenario.inspector.stop', 'Stop')

  // Run-logs view (only when no box is selected) — the shared
  // `ScenarioRunLogView` (also used by the run-history modal) renders the
  // toggle + ListView + expandable data; here we just gate on having any.
  const allLogs = runLog ?? []

  return (
    <div ref={panelRef} className="scn-inspector nodrag nopan" data-testid="scenario-inspector-panel">
      {/* Run toolbar — Run flips the BorderBeam orbit on the selected node
       * (toggle: clicking again becomes Pause). Debug is a one-shot trigger
       * that fires a single travelling beam along every outgoing edge of
       * the previewed box — represents one data/event crossing the link.
       * Step stays visual-only until the real engine wires in. */}
      <div className="scn-inspector-toolbar" data-testid="scenario-inspector-toolbar">
        <Button small secondary icon={runIcon} onClick={onRun} disabled={runDisabled} options={{ ariaLabel: runLabel, title: runLabel }} data-testid="scenario-inspector-run" />
        <Button small secondary icon="debug-alt" onClick={onDebug} disabled={debugDisabled} options={{ ariaLabel: debugLabel, title: debugLabel }} data-testid="scenario-inspector-debug" />
        <Button small secondary icon="debug-step-over" onClick={onStep} disabled={stepDisabled} options={{ ariaLabel: t('scenario.inspector.step', 'Step'), title: t('scenario.inspector.step', 'Step') }} data-testid="scenario-inspector-step" />
        {engineWired && (
          <Button small secondary icon="debug-stop" onClick={onStop} disabled={stopDisabled} options={{ ariaLabel: stopLabel, title: stopLabel }} data-testid="scenario-inspector-stop" />
        )}
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
            {/* First row when the box wraps a navigable item — a small
              * link to its tab so the inspector doubles as the box's
              * "open" affordance. Same handler the node-box's
              * "Edit request / scenario" row uses. */}
            {previewNode.openItemId && previewNode.openItemKind && onOpenItem && (
              <button
                type="button"
                className="scn-inspector-open"
                onClick={() => {
                  const id = previewNode.openItemId
                  if (id) onOpenItem(id)
                }}
                data-testid="scenario-inspector-open"
              >
                {previewNode.openItemKind === 'request'
                  ? t('scenario.editRequest', 'Edit request')
                  : t('scenario.editScenario', 'Edit scenario')}
              </button>
            )}
            {previewNode.note && <div className="scn-inspector-note">{previewNode.note}</div>}
            {/* Inline play button — visible whenever the box is runnable AND
              * carries no real run result yet, both for the "no data at all"
              * case (fall back to the hint label) AND alongside a synthetic
              * preview (so the user can populate it with a real run from the
              * panel without losing the placeholder tree). Once a real result
              * lands, the toolbar's Run button is the only run trigger. */}
            {realData === null && previewNode.runnable === true && (
              <div className="scn-inspector-run-prompt" role="note">
                <Button
                  small
                  secondary
                  icon={running ? 'loading' : 'play'}
                  disabled={running}
                  onClick={() => {
                    if (!previewId) return
                    const rt = scenarioRuntime()
                    const runFn = rt?.runScenarioNode
                    if (!runFn) return
                    setRunning(true)
                    void (async () => {
                      try { await runFn(scenarioId, previewId) } catch { /* swallow — error already surfaces in workflow validation */ }
                      finally { setRunning(false); setRunVersion((v) => v + 1) }
                    })()
                  }}
                  options={{
                    ariaLabel: t('scenario.inspector.run', 'Run'),
                    title: t('scenario.inspector.run', 'Run')
                  }}
                  data-testid="scenario-inspector-inline-run"
                />
                <span>{isSynthetic
                  ? t('scenario.inspector.syntheticRunHint', 'Sample data — run the request to replace it with a real result.')
                  : t('scenario.inspector.noRunsHint', 'No recent run for this request — run it from here to populate the scenario preview.')}</span>
              </div>
            )}
            {data !== null && (
              <>
                <div className="scn-inspector-info" role="note">
                  <i className={`codicon codicon-${isSynthetic ? 'beaker' : 'info'}`} aria-hidden="true" />
                  <span>{isSynthetic
                    ? t('scenario.inspector.syntheticInfo', 'Example data generated from this request\'s documentation.')
                    : t('scenario.inspector.previewInfo', 'Example data, based on previous request results.')}</span>
                </div>
                <div className="scn-inspector-output">
                  <div className="scn-inspector-tree">
                    <ListView items={buildScenarioPathTree(data)} selectionMode="single" selectedIds={[]} data-testid="scenario-inspector-result" />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* No box selected → run logs of the current / last run. Nothing
        * is shown until there's at least one run to display. */}
      {!previewNode && allLogs.length > 0 && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-logs">
            <div className="scn-inspector-section-title scn-inspector-logs-header">
              <span>{t('scenario.inspector.logsTitle', 'Run logs')}</span>
            </div>
            <ScenarioRunLogView logs={allLogs} testIdPrefix="scenario-inspector-logs" onFocusNode={onFocusNode} {...(onClearRunLog ? { onClear: onClearRunLog } : {})} {...(logProvenance ? { provenance: logProvenance } : {})} />
          </div>
        </>
      )}
    </div>
  )
}

export default ScenarioInspectorPanel
