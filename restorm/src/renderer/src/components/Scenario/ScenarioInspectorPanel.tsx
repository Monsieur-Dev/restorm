import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, GatedControl, ListView, Sash, usePlatform, type IVerticalSashLayoutProvider, type SashEvent, type SashState } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { useCapability } from '../../hooks/useCapability'
import { subscribeToPro } from '../../services/subscribeToPro'
import type { ScenarioLogEntry } from '../../hooks/useScenarioEngine'
import { ScenarioRunLogView, type LogLevelFilter } from './ScenarioRunLogView'
import { ScenarioInspectorLegend } from './ScenarioInspectorLegend'
import type { ScenarioPort } from '../../../../shared/types/collections'
import type { ScenarioNodeError } from '../../../../shared/scenarioValidation'
import { buildScenarioPathTree } from './scenarioPathTree'
import { withValueTooltips } from './scenarioTreeTooltips'
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
  /** The node's kind — drives the "what this action does" help text shown in
   * the panel (i18n `scenario.help.<kind>`). */
  kind: string
  /** Optional override for the help-text key (i18n `scenario.help.<helpKey>`)
   * when one kind needs a role-specific blurb — e.g. a `socketioConnect` bound
   * to a SERVER request reads "starts a server", not "opens a connection". */
  helpKey?: string
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
  /** Whether the engine reports this node as currently running — drives the
   * BorderBeam trail and the toolbar Run button's Play↔Pause toggle. */
  running?: boolean
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
  /** The scenario's display name — drives the headless-CLI command shown in the
   * empty-inspector help. Omitted in contexts without a single named scenario. */
  scenarioName?: string
  /** Flat list of every box error (with the box title), for the errors section. */
  errors: { nodeId: string; title: string; error: ScenarioNodeError }[]
  /** Distinct boxes in error — drives the section header count. */
  errorBoxCount: number
  /** Centre the canvas on a box (clicking an error row). */
  onFocusNode: (nodeId: string, scenarioId?: string, anchor?: { x: number; y: number }) => void
  /** The node to preview, or null when zero / many boxes are selected. */
  previewNode: InspectorPreviewNode | null
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
  /** Launch a fresh run armed in step mode (paused at the start), then advance
   * one step — wired to the Step button when no run is in progress. */
  onEngineStepStart?: () => void
  onEngineStop?: () => void
  /** Launch a DEBUG run (honors breakpoints). Distinct from Run/Play, which
   * ignores them. Wired to the debug disc, left of Play. */
  onEngineDebug?: () => void
  /** Debug pressed while a run is already live — turn it into a debug run
   * (honor breakpoints from now on) and continue to the next breakpoint. */
  onEngineDebugContinue?: () => void
  /** Whether the scenario has ≥1 breakpoint — the debug disc is greyed when
   * false (nothing to break on). */
  hasBreakpoints?: boolean
  /** Chronological run log (current or last run, whole tree merged).
   * Shown in the panel body when NO box is selected. */
  runLog?: readonly ScenarioLogEntry[]
  /** Clears the displayed run log. Wired only in the live inspector — the
   * persisted run-history is read-only and offers no clear action. */
  onClearRunLog?: () => void
  /** Whether an undo / redo step is available — drives the toolbar buttons'
   * disabled state. */
  canUndo?: boolean
  canRedo?: boolean
  /** Undo / redo the last graph edit on the active scenario tab. */
  onUndo?: () => void
  onRedo?: () => void
}

interface ScenarioRuntime {
  getScenarioNodeResult?: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
  runScenarioNode?: (scenarioId: string, nodeId: string) => Promise<unknown>
}
function scenarioRuntime(): ScenarioRuntime | undefined {
  return (window as { restorm?: { runtime?: ScenarioRuntime } }).restorm?.runtime
}

const INSPECTOR_DEFAULT_WIDTH = 450
const INSPECTOR_MIN_WIDTH = 450
/** Minimum width to leave for the graph canvas when the inspector is stretched. */
const INSPECTOR_MIN_CANVAS_WIDTH = 200
const INSPECTOR_WIDTH_KEY = 'scenario-inspector-width'
/** Folded state of the panel — a per-user preference, persisted like the
 * width so the canvas stays clear across sessions once folded. */
const INSPECTOR_COLLAPSED_KEY = 'scenario-inspector-collapsed'

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
export const ScenarioInspectorPanel: React.FC<ScenarioInspectorPanelProps> = ({ scenarioId, scenarioName, errors, errorBoxCount, onFocusNode, previewNode, onOpenItem, engineState, onEngineRun, onEnginePause, onEngineResume, onEngineStep, onEngineStepStart, onEngineStop, onEngineDebug, onEngineDebugContinue, hasBreakpoints, runLog, onClearRunLog, canUndo, canRedo, onUndo, onRedo }) => {
  const { t } = useTranslation()
  const { isMacintosh, isWindows } = usePlatform()
  // Step-debug (Step + Debug) is a Pro capability: greyed + upsell when absent,
  // fully functional when granted. Run / Stop stay free baseline.
  const stepDebugLocked = !useCapability('scenario.stepDebug')
  const handleSubscribe = (): void => { void subscribeToPro() }
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const fetchToken = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  // Log-view filters live HERE (the panel persists across runs), not inside
  // `ScenarioRunLogView` — which unmounts on each new run, so its own state
  // would reset the "show all" toggle + level filters every run.
  const [showAllLogs, setShowAllLogs] = useState(false)
  const [logLevels, setLogLevels] = useState<LogLevelFilter>({ debug: true, info: true, warn: true, error: true })

  // ── Inspector width (resizable sash) ──────────────────────────────────────
  // Width persists in localStorage; the sash sits at the panel's left edge so
  // dragging left grows the inspector and dragging right shrinks it.
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(INSPECTOR_WIDTH_KEY)
      if (stored) {
        const parsed = parseInt(stored, 10)
        // Clamp UP rather than discard: a width persisted from before the
        // minimum was raised should still open at the new floor, not silently
        // reset to the default.
        if (!isNaN(parsed)) return Math.max(parsed, INSPECTOR_MIN_WIDTH)
      }
    } catch { /* ignore */ }
    return INSPECTOR_DEFAULT_WIDTH
  })
  useEffect(() => {
    try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth)) } catch { /* ignore */ }
  }, [inspectorWidth])

  // ── Folded state ──────────────────────────────────────────────────────────
  // Folded, the panel keeps only its toolbar: errors, preview, logs and the
  // help legend all go, and the panel shrinks to the toolbar's own width so the
  // canvas gets the space back. The same button unfolds it.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(INSPECTOR_COLLAPSED_KEY) === 'true' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(collapsed)) } catch { /* ignore */ }
  }, [collapsed])

  // Track the editor container width so the sash can clamp the max inspector width.
  const [editorWidth, setEditorWidth] = useState(0)
  useEffect(() => {
    const parent = panelRef.current?.parentElement
    if (!parent) return
    const obs = new ResizeObserver(() => { setEditorWidth(parent.clientWidth) })
    setEditorWidth(parent.clientWidth)
    obs.observe(parent)
    return () => { obs.disconnect() }
  }, [])

  // Re-clamp a persisted/stale width whenever the editor is measured or resized —
  // a width saved from a wider window (or a shrunk window since) would otherwise
  // leave the inspector wider than the canvas, since the drag handler is the only
  // other place that clamps.
  useEffect(() => {
    if (editorWidth <= 0) return
    const maxWidth = editorWidth - 8 - INSPECTOR_MIN_CANVAS_WIDTH
    setInspectorWidth((current) => Math.min(current, Math.max(INSPECTOR_MIN_WIDTH, maxWidth)))
  }, [editorWidth])

  // Sash layout provider: sash is anchored to the panel's left edge (left=0).
  // getVerticalSashHeight is REQUIRED, not optional: the Sash component's own
  // inline `style` prop sets `height: 'auto'` for a vertical sash, which wins
  // over the CSS `.sash.vertical { height: 100% }` rule (inline beats
  // stylesheet) — omitting it leaves the sash's actual height at 0 (no
  // content), invisible and unhittable even though it's correctly positioned.
  const sashLayoutProvider: IVerticalSashLayoutProvider = useMemo(
    () => ({
      getVerticalSashLeft: () => 0,
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => panelRef.current?.clientHeight ?? 0
    }),
    []
  )

  const sashStartWidthRef = useRef(inspectorWidth)
  const handleSashStart = useCallback((_event: SashEvent): void => {
    sashStartWidthRef.current = inspectorWidth
  }, [inspectorWidth])

  const handleSashChange = useCallback((event: SashEvent): void => {
    const delta = event.currentX - event.startX
    // Dragging LEFT (negative delta) grows the right-anchored inspector.
    const rawWidth = sashStartWidthRef.current - delta
    const parentW = panelRef.current?.parentElement?.clientWidth ?? 0
    const maxWidth = parentW > 0 ? parentW - 8 - INSPECTOR_MIN_CANVAS_WIDTH : 800
    setInspectorWidth(Math.min(maxWidth, Math.max(INSPECTOR_MIN_WIDTH, rawWidth)))
  }, [])

  // Cursor state: sash cursor indicates which direction it can still move.
  // The sash is at the LEFT edge of a RIGHT-anchored panel, so the semantics
  // are inverted vs. a standard left-panel split.
  const sashState: SashState = (() => {
    if (inspectorWidth <= INSPECTOR_MIN_WIDTH) return 'atMaximum' // can only grow (drag left) → w-resize
    if (editorWidth > 0) {
      const maxWidth = editorWidth - 8 - INSPECTOR_MIN_CANVAS_WIDTH
      if (inspectorWidth >= maxWidth) return 'atMinimum' // can only shrink (drag right) → e-resize
    }
    return 'enabled'
  })()
  // ─────────────────────────────────────────────────────────────────────────

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
      // Measuring the natural height means briefly setting `height: auto`, which
      // removes the overflow on any nested scrollable (the run-log ListView) for
      // one reflow — the browser then clamps its scrollTop to 0. Snapshot every
      // inner scroller and restore it once the definite (overflowing) height is
      // back, or the log list jumps to the top on every expand/collapse.
      const scrollers = Array.from(panel.querySelectorAll<HTMLElement>('.scrollable-content'))
      const tops = scrollers.map((s) => s.scrollTop)
      panel.style.height = 'auto'
      const natural = panel.scrollHeight
      const available = parent.clientHeight - 16
      panel.style.height = `${Math.min(natural, available)}px`
      scrollers.forEach((s, i) => { const t = tops[i]; if (t !== undefined && s.scrollTop !== t) s.scrollTop = t })
    }
    apply()
    // Canvas resize → recompute available height; tree expand/collapse changes
    // the row count → recompute natural height.
    const ro = new ResizeObserver(apply)
    ro.observe(parent)
    const mo = new MutationObserver(apply)
    mo.observe(panel, { childList: true, subtree: true })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [previewNode, result, errors.length, collapsed])

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
  // The host wires `onEngineRun`, so the toolbar drives the real engine: Run
  // kicks off the scenario; Pause/Resume + Step + Stop are live controls; the
  // Run button swaps to a Pause icon while running and back to Play while
  // paused/idle.
  const engineWired = onEngineRun !== undefined
  const onRun = (): void => {
    if (onEngineRun === undefined) return
    if (engineState === 'running') onEnginePause?.()
    else if (engineState === 'paused') onEngineResume?.()
    else onEngineRun()
  }
  const onStep = (): void => {
    if (!engineWired) return
    if (engineState === 'paused' || engineState === 'running') {
      onEngineStep?.()
    } else {
      // Idle / finished → launch a fresh run armed in step mode, then advance.
      onEngineStepStart?.()
    }
  }
  const onStop = (): void => {
    if (engineWired) onEngineStop?.()
  }
  // Debug disc = VS Code's F5 ("Start Debugging" / "Continue"): from idle it
  // launches a debug run (honors breakpoints); while paused at a breakpoint it
  // resumes to the NEXT one; while running it's a no-op. Only greyed when the
  // scenario has no breakpoint to break on. The plain Play disc never honors
  // breakpoints.
  const onDebug = (): void => {
    if (!engineWired || hasBreakpoints !== true) return
    // From idle → launch a debug run. While a run is already live (running or
    // paused, incl. a plain Play run) → turn it into a debug run + continue to
    // the next breakpoint.
    if (engineState === 'running' || engineState === 'paused') onEngineDebugContinue?.()
    else onEngineDebug?.()
  }
  // A scenario carrying validation errors can't START a run — block Play / Step
  // / Debug while idle/finished (mirrors the engine + MCP gate). Live controls
  // (pause/resume/step a RUNNING or PAUSED run) stay enabled: errors can't
  // appear mid-run (the graph is edit-locked while running).
  const cannotStartFresh = errorBoxCount > 0 && engineState !== 'running' && engineState !== 'paused'
  const debugDisabled = !engineWired || hasBreakpoints !== true || cannotStartFresh
  const debugLabel = t('scenario.inspector.debug', 'Debug')
  const runDisabled = !engineWired || cannotStartFresh
  // Step is live whenever the engine is wired: it steps a paused/running run,
  // or launches a fresh one in step mode from idle/finished.
  const stepDisabled = !engineWired || cannotStartFresh
  const stopDisabled = !engineWired || (engineState !== 'running' && engineState !== 'paused')
  const runIsPause = engineState === 'running'
  const runIcon = runIsPause ? 'debug-pause' : 'play'
  const runLabel = runIsPause
    ? t('scenario.inspector.pause', 'Pause')
    : t('scenario.inspector.run', 'Run')
  const stepLabel = t('scenario.inspector.step', 'Step')
  const stopLabel = t('scenario.inspector.stop', 'Stop')
  // Keyboard-shortcut hints shown in the hover tooltips. App-specific scheme
  // (NOT VS Code's): F5 launches everywhere (kept consistent with running a
  // request from its own tab), F6 debugs, F7 steps, and the Pause key pauses.
  // `aria-label` stays the plain label; the shortcut only decorates the visible
  // tooltip. (The actual key bindings land in a follow-up.)
  const runTooltip = cannotStartFresh
    ? t('scenario.validation.runBlocked', { count: errorBoxCount, defaultValue: 'Fix {{count}} action error(s) before running' })
    : `${runLabel} (${runIsPause ? 'Pause' : 'F5'})`
  const stepTooltip = `${stepLabel} (F7)`
  const debugTooltip = `${debugLabel} (F6)`
  const stopTooltip = `${stopLabel} (F8)`
  // Undo / redo — the visible shortcut hint follows the platform mapping owned
  // by ECUI (Cmd on macOS, Ctrl elsewhere; redo is Ctrl+Y on Windows but
  // Ctrl/Cmd+Shift+Z on Linux/macOS).
  const undoLabel = t('scenario.inspector.undo', 'Undo')
  const redoLabel = t('scenario.inspector.redo', 'Redo')
  const mod = isMacintosh ? '⌘' : 'Ctrl'
  const undoTooltip = `${undoLabel} (${mod}+Z)`
  const redoTooltip = `${redoLabel} (${isMacintosh ? '⌘+⇧+Z' : isWindows ? 'Ctrl+Y' : 'Ctrl+Shift+Z'})`
  const collapseLabel = collapsed
    ? t('scenario.inspector.expandPanel', 'Expand the inspector')
    : t('scenario.inspector.collapsePanel', 'Collapse the inspector')

  // Run-logs view (only when no box is selected) — the shared
  // `ScenarioRunLogView` (also used by the run-history modal) renders the
  // toggle + ListView + expandable data; here we just gate on having any.
  const allLogs = runLog ?? []

  return (
    <div
      ref={panelRef}
      className={`scn-inspector nodrag nopan${collapsed ? ' scn-inspector-collapsed' : ''}`}
      // Folded, the panel sizes to its toolbar (the stored width is kept for
      // when it unfolds), so no inline width is imposed.
      {...(collapsed ? {} : { style: { width: inspectorWidth } })}
      data-testid="scenario-inspector-panel"
    >
      {/* Sash at the left edge — drag left to widen, drag right to narrow.
        * Folded there is nothing to resize, so it is not rendered. */}
      {!collapsed && (
        <Sash
          orientation="vertical"
          layoutProvider={sashLayoutProvider}
          state={sashState}
          onStart={handleSashStart}
          onChange={handleSashChange}
          data-testid="scenario-inspector-sash"
        />
      )}
      {/* Run toolbar — Run flips the BorderBeam orbit on the selected node
       * (toggle: clicking again becomes Pause). Debug is a one-shot trigger
       * that fires a single travelling beam along every outgoing edge of
       * the previewed box — represents one data/event crossing the link.
       * Step stays visual-only until the real engine wires in. */}
      <div className="scn-inspector-toolbar" data-testid="scenario-inspector-toolbar">
        {/* aria-label kept (invisible — screen-reader name only); the styled
         * hover label comes from the ECUI Tooltip wrapper. No `title` so the
         * native browser tooltip never shows. */}
        {onUndo && (
          <>
            <HeaderHoverTooltip label={undoTooltip}>
              <Button small icon="discard" onClick={onUndo} disabled={canUndo !== true} className="scn-inspector-undo-round" options={{ ariaLabel: undoLabel }} data-testid="scenario-inspector-undo" />
            </HeaderHoverTooltip>
            <HeaderHoverTooltip label={redoTooltip}>
              <Button small icon="redo" onClick={onRedo} disabled={canRedo !== true} className="scn-inspector-redo-round" options={{ ariaLabel: redoLabel }} data-testid="scenario-inspector-redo" />
            </HeaderHoverTooltip>
            <div className="scn-inspector-toolbar-sep" aria-hidden="true" />
          </>
        )}
        <HeaderHoverTooltip label={collapseLabel}>
          <Button
            small
            icon={collapsed ? 'chevron-down' : 'chevron-up'}
            onClick={() => { setCollapsed((c) => !c) }}
            className="scn-inspector-collapse-round"
            options={{ ariaLabel: collapseLabel }}
            data-testid="scenario-inspector-collapse"
          />
        </HeaderHoverTooltip>
        <HeaderHoverTooltip label={runTooltip}>
          <Button appearance="round" icon={runIcon} onClick={onRun} disabled={runDisabled} className={`scn-inspector-run-round${runIsPause ? ' scn-inspector-run-round-active' : ''}`} options={{ ariaLabel: runLabel }} data-testid="scenario-inspector-run" />
        </HeaderHoverTooltip>
        <GatedControl locked={stepDebugLocked} onSubscribe={handleSubscribe} data-testid="scenario-inspector-step-gate">
          <HeaderHoverTooltip label={stepTooltip}>
            <Button appearance="round" icon="debug-step-over" onClick={onStep} disabled={stepDisabled} className="scn-inspector-step-round" options={{ ariaLabel: stepLabel }} data-testid="scenario-inspector-step" />
          </HeaderHoverTooltip>
        </GatedControl>
        {engineWired && (
          <GatedControl locked={stepDebugLocked} onSubscribe={handleSubscribe} data-testid="scenario-inspector-debug-gate">
            <HeaderHoverTooltip label={debugTooltip}>
              <Button appearance="round" icon="debug-alt" onClick={onDebug} disabled={debugDisabled} className="scn-inspector-debug-round" options={{ ariaLabel: debugLabel }} data-testid="scenario-inspector-debug" />
            </HeaderHoverTooltip>
          </GatedControl>
        )}
        {engineWired && (
          <HeaderHoverTooltip label={stopTooltip}>
            <Button appearance="round" icon="debug-stop" onClick={onStop} disabled={stopDisabled} className="scn-inspector-stop-round" options={{ ariaLabel: stopLabel }} data-testid="scenario-inspector-stop" />
          </HeaderHoverTooltip>
        )}
      </div>

      {/* Folded → the toolbar is the whole panel: no errors, no preview, no
        * logs, no legend. */}
      {!collapsed && hasErrors && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-errors">
            <div className="scn-inspector-section-title scn-inspector-errors-title">
              <i className="codicon codicon-error" aria-hidden="true" />
              {t('scenario.validation.panelTitle', { count: errorBoxCount, defaultValue: '{{count}} action error(s)' })}
            </div>
            {errors.map(({ nodeId, title, error }) => (
              <Button
                key={`${nodeId}-${error.code}`}
                link
                className="scn-error-row"
                onClick={() => { onFocusNode(nodeId) }}
                options={{ ariaLabel: t('scenario.validation.focusBox', 'Focus this action') }}
              >
                <span style={{ opacity: 0.8 }}>{title}</span> — {error.message}
              </Button>
            ))}
          </div>
        </>
      )}

      {!collapsed && previewNode && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-preview">
            {/* When the box wraps a navigable item, the title IS the link to its
              * tab (badge as the leading icon) — the inspector doubles as the
              * box's "open" affordance, so no separate "Edit" row is needed.
              * Otherwise the title is plain text. */}
            <div className="scn-inspector-section-title scn-inspector-preview-header">
              {previewNode.openItemId && previewNode.openItemKind && onOpenItem ? (
                <Button
                  externalLink
                  icon={previewNode.titleBadge as React.ReactElement}
                  className="scn-inspector-title-link"
                  onClick={() => {
                    const id = previewNode.openItemId
                    if (id) onOpenItem(id)
                  }}
                  data-testid="scenario-inspector-open"
                >
                  {previewNode.title}
                </Button>
              ) : (
                <>
                  {previewNode.titleBadge}
                  <span>{previewNode.title}</span>
                </>
              )}
            </div>
            {previewNode.note && <div className="scn-inspector-note">{previewNode.note}</div>}
            {/* What this action does — the translatable per-kind help text.
              * Always shown for the selected box (concise), with the legend
              * still sitting in the footer below. */}
            {(() => {
              const helpText = t(`scenario.help.${previewNode.helpKey ?? previewNode.kind}`, '')
              return helpText
                ? (
                  <div className="scn-inspector-help" data-testid="scenario-inspector-help">
                    <div className="scn-inspector-help-title">{t('scenario.inspector.helpTitle', 'What this action does')}</div>
                    <div className="scn-inspector-help-text">{helpText}</div>
                  </div>
                  )
                : null
            })()}
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
                    ariaLabel: t('scenario.inspector.run', 'Run')
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
                    <ListView items={withValueTooltips(buildScenarioPathTree(data))} selectionMode="single" selectedIds={[]} data-testid="scenario-inspector-result" />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* No box selected → run logs of the current / last run. Nothing
        * is shown until there's at least one run to display. */}
      {!collapsed && !previewNode && allLogs.length > 0 && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-logs">
            <div className="scn-inspector-section-title scn-inspector-logs-header">
              <span>{t('scenario.inspector.logsTitle', 'Run logs')}</span>
            </div>
            <ScenarioRunLogView logs={allLogs} testIdPrefix="scenario-inspector-logs" onFocusNode={onFocusNode} showAllLogs={showAllLogs} onShowAllLogsChange={setShowAllLogs} levels={logLevels} onLevelsChange={setLogLevels} {...(onClearRunLog ? { onClear: onClearRunLog } : {})} />
          </div>
        </>
      )}

      {/* Help legend — ONLY in the truly empty inspector (no box selected AND no
        * run-log). A selected box shows its preview instead (the legend would
        * push it out of view); a run shows its logs. */}
      {!collapsed && previewNode === null && allLogs.length === 0 && (
        <>
          <div className="scn-inspector-sep" />
          <ScenarioInspectorLegend
            {...(scenarioName !== undefined ? { cliScenarioName: scenarioName, cliScenarioId: scenarioId } : {})}
          />
        </>
      )}
    </div>
  )
}
