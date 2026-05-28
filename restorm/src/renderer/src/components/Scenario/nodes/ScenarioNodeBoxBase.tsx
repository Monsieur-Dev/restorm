import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Handle, Position, useNodeConnections, useUpdateNodeInternals, type Node } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button, getContrastColor, MarkdownViewer, Tooltip } from 'electron-core-ui/renderer'
import type { ScenarioNodeKind, ScenarioPort, ScenarioPortRole, PortFlow } from '../../../../../shared/types/collections'
import { scenarioNodeMeta } from '../scenarioNodeCatalogue'
import { useScenarioNodeErrors } from '../scenarioErrorsContext'
import { ROLE_COLOR } from '../scenarioGraphMapping'
import { ScenarioNodeSection } from './ScenarioNodeSection'
import { anchorColor, cellBody, portAnchorColor, inputFlowRingClass, outputFlowRingClass, cellInputRingClass, cellOutputRingClass } from './scenarioCellRender'
import '../ScenarioNodeBox.css'

/** React Flow node data shared by every scenario node box. */
export interface ScenarioNodeBoxData extends Record<string, unknown> {
  kind: ScenarioNodeKind
  /** Owning scenario id — lets the play button call the run/cancel engine.
   * Undefined for nodes seeded before this was threaded through (no-op click). */
  scenarioId?: string
  note?: string
  color?: string
  collapsed?: boolean
  /** Per-kind config bag (e.g. bound request/scenario id + display label). */
  config?: Record<string, unknown>
  inputs: ScenarioPort[]
  outputs: ScenarioPort[]
  /** Run status for the live-execution overlay (Phase 2); drives the badge. */
  status?: 'idle' | 'running' | 'ok' | 'error'
  onToggleCollapse?: (id: string) => void
  /** Right-click on the header opens the node context menu at the cursor. */
  onHeaderContextMenu?: (id: string, x: number, y: number) => void
  /** Persist a patch into the node's per-kind config bag (merged + saved). */
  onSetConfig?: (id: string, config: Record<string, unknown>) => void
  /** Open a tree item (the bound request / sub-scenario) in a workbench tab,
   * by id — drives the "Edit request / scenario" link. */
  onOpenItem?: (itemId: string) => void
}

export type ScenarioNodeBoxType = Node<ScenarioNodeBoxData, 'scenarioNode'>

/**
 * One row in a column. `content` (any React node) wins over `label`; `port`
 * adds a coloured anchor handle on the column's outer edge.
 */
export interface ScenarioNodeCell {
  id: string
  label?: string
  /** Value shown opposite the label (KV rows: param name ↔ value). */
  value?: ReactNode
  content?: ReactNode
  /** Optional hover tooltip on the cell label (e.g. a param description). */
  tooltip?: string
  port?: { id: string; role?: ScenarioPortRole; type: 'target' | 'source'; required?: boolean; orphan?: boolean; flow?: PortFlow }
}

/**
 * A group of rows in the left column. A blank `name` renders the rows flat
 * (no header — the original behavior); a named section is a collapsible
 * panel whose anchors sit on each row when open and gather at the section
 * title when collapsed.
 */
export interface ScenarioNodeSection {
  id: string
  name?: string
  rows: ScenarioNodeCell[]
}

export interface ScenarioNodeBoxBaseProps {
  id: string
  data: ScenarioNodeBoxData
  selected?: boolean
  /** Sections of the left (inputs) column. Blank-named = flat rows. */
  left: ScenarioNodeSection[]
  /** Rows of the right (outputs) column. */
  right: ScenarioNodeCell[]
  /** Override the header icon (e.g. a method/scenario badge); defaults to the kind codicon. */
  headerIcon?: ReactNode
  /** Override the header title; defaults to the kind's label. */
  title?: string
  /**
   * Whether the node accepts a generic "launch" input — a target anchor on
   * the left of the header (id `in`). Lets nodes be chained without a
   * dedicated condition (e.g. one request's `response` → the next's launch,
   * or a `setVariable`'s `event` → an `if`'s launch).
   */
  launchInput?: boolean
  /**
   * Whether the node emits a generic "event" output — a source anchor on the
   * right of the header (id `event`, signal flow). Lets a node signal
   * completion to chain the next node's launch input without producing a data
   * value (e.g. `setVariable`, which stores its input and fires this event).
   */
  headerEventOutput?: boolean
  /**
   * Whether the node can be run on its own right now. Drives the header
   * play button's colour: green when runnable, grey otherwise (e.g. an `if`
   * that needs its inputs produced first). Defaults to false.
   */
  canPlay?: boolean
  /**
   * Whether the node exposes the dedicated error output port (bottom). Most
   * nodes can fail, so it defaults to true; set false for kinds that can't
   * error (e.g. `now`), where an error anchor would be meaningless.
   */
  hasError?: boolean
}

const STATUS_GLYPH: Record<NonNullable<ScenarioNodeBoxData['status']>, string> = {
  idle: '',
  running: 'sync',
  ok: 'pass-filled',
  error: 'error'
}

/**
 * Generic scenario node box (epic §5b base): header (kind icon + label +
 * collapse + status badge), an optional markdown notes band, a structured
 * two-column body (rows with optional coloured anchors on the outer edge),
 * box colour with auto-contrast, and the dedicated error port. Per-kind
 * components (IfNodeBox, …) compose this and only declare their columns.
 */
export const ScenarioNodeBoxBase: React.FC<ScenarioNodeBoxBaseProps> = ({ id, data, selected, left, right, headerIcon, title, launchInput, headerEventOutput, canPlay, hasError }) => {
  const { t } = useTranslation()
  const meta = scenarioNodeMeta(data.kind)
  // A box in a non-executable state (missing name, unsatisfied input, …) is
  // flagged red and its play button disabled; the errors are aggregated into
  // the workflow error panel.
  const errors = useScenarioNodeErrors(id)
  const boxInError = errors.length > 0
  const collapsed = data.collapsed === true
  const note = data.note
  const leftRows = left.flatMap((s) => s.rows)
  // Carry the cell's `label` alongside each port so the collapsed-mode handle
  // tooltip surfaces the user-readable name (eg. "started_at", "Glaude"),
  // not the generated id (eg. `prop-1779949045488-…`, `case-1779946367569-…`).
  // Per-kind components that mint dynamic ports — `object` properties,
  // `switch` cases — set `cell.label` to the user-given name so this lookup
  // resolves; static ports already carry their own `cell.label`.
  const allPorts: (NonNullable<ScenarioNodeCell['port']> & { _label?: string })[] =
    [...leftRows, ...right].flatMap((c) => (c.port ? [{ ...c.port, ...(c.label ? { _label: c.label } : {}) }] : []))

  // Animate the fold/unfold of the body+notes block. Two-phase render keeps
  // both ends smooth without ever duplicating React Flow handles:
  //
  //  - bodyMounted drives whether the body (and its inline `<Handle>`s) is in
  //    the DOM. It stays true through the closing transition, then flips false
  //    once the CSS animation has finished — so the header-position handles
  //    only appear after the inline ones are gone.
  //  - bodyOpen drives the `.scn-body-open` class that runs the
  //    `grid-template-rows`/`opacity` transition.
  //
  // On expand we mount the body first and flip the class on the next animation
  // frame, so the browser sees a 0 → 1 transition (not an instant 1). On
  // collapse we drop the class immediately and unmount the body after the
  // transition duration.
  // Animation: opacity fade (phase 1) and height/handles morph (phase 2) play
  // back-to-back, not concurrently. Total runtime is ANIM_MS; each phase gets
  // half. The CSS-side `transition-delay` on the inner wrapper sequences the
  // two: closing first fades content (0→half) then shrinks height + handle
  // positions (half→full); opening reverses that order.
  const ANIM_MS = 400
  const [bodyMounted, setBodyMounted] = useState(!collapsed)
  const [bodyOpen, setBodyOpen] = useState(!collapsed)
  const rafHandle = useRef<number | null>(null)
  // `animating` is armed synchronously by `onToggle` BEFORE the parent flips
  // `collapsed`. Any flip that arrives without going through `onToggle` (eg.
  // parent state hydration replaying the persisted state, MCP graph patch)
  // keeps `animating` at false, so CSS transitions stay off and the body
  // state snaps in the effect below.
  const [animating, dispatchAnim] = useReducer((_state: boolean, on: boolean) => on, false)
  useEffect(() => {
    if (!animating) return undefined
    const t = setTimeout(() => { dispatchAnim(false) }, ANIM_MS)
    return () => { clearTimeout(t) }
  }, [animating, collapsed])
  useEffect(() => {
    if (!animating) {
      // Non-user change (parent hydration, MCP patch, …): snap the body
      // state to match `collapsed` without running the animation timer.
      // CSS transitions are also gated on `data-animating="true"`, so the
      // visual is instant.
      queueMicrotask(() => {
        setBodyMounted(!collapsed)
        setBodyOpen(!collapsed)
      })
      return undefined
    }
    if (!collapsed) {
      // Expand: mount the body first, flip the class on the next frame so the
      // browser sees a 0 → 1 transition rather than starting at 1.
      const raf1 = requestAnimationFrame(() => {
        setBodyMounted(true)
        rafHandle.current = requestAnimationFrame(() => { setBodyOpen(true) })
      })
      rafHandle.current = raf1
      return () => { if (rafHandle.current != null) cancelAnimationFrame(rafHandle.current) }
    }
    // Collapse: flip the class via a microtask — runs before the next browser
    // paint, so there's no perceptible delay between the click and the start
    // of the opacity fade. The full unmount waits the entire animation.
    queueMicrotask(() => { setBodyOpen(false) })
    const timer = setTimeout(() => { setBodyMounted(false) }, ANIM_MS)
    return () => { clearTimeout(timer) }
  }, [collapsed, animating])

  // Single source of port handles: rendered as siblings of the body, absolute-
  // positioned on the box. Their `top` value comes from a layout-time
  // measurement of each row's vertical centre (the `[data-port-id]` marker on
  // the row), and snaps to the header centre when the node is collapsed. A
  // CSS transition on `top` (delayed by the opacity phase) slides each handle
  // smoothly between its expanded and collapsed position, instead of the
  // previous swap that snapped the moment the body unmounted.
  const boxRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [rowTops, setRowTops] = useState<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    // Walk each marker's `offsetParent` chain up to the box, summing
    // `offsetTop`. `getBoundingClientRect` would include the React Flow
    // viewport's `scale(zoom)` transform, but CSS `top` values stay in
    // pre-transform px — so we'd render misaligned at any non-1 zoom.
    // `.scn-node` is `position: relative`, so it sits in the offsetParent
    // chain and the walk terminates there for both rows and section
    // markers.
    const next = new Map<string, number>()
    box.querySelectorAll<HTMLElement>('[data-port-id]').forEach((el) => {
      const portId = el.dataset['portId']
      if (!portId) return
      let top = 0
      let cur: HTMLElement | null = el
      while (cur && cur !== box) {
        top += cur.offsetTop
        cur = cur.offsetParent as HTMLElement | null
      }
      next.set(portId, top + el.offsetHeight / 2)
    })
    // Defer the setState to a microtask: the rule forbids a synchronous setState
    // in an effect (it would cascade-render in the same commit), but a deferred
    // one is the standard "publish layout measurements" pattern.
    queueMicrotask(() => {
      setRowTops((prev) => {
        if (prev.size !== next.size) return next
        for (const [k, v] of next) if (prev.get(k) !== v) return next
        return prev
      })
    })
  }, [bodyMounted, bodyOpen, left, right, errors.length, collapsed])
  // Collapsed-mode handle position = vertical centre of the header. Measured
  // once per header layout so a coloured/notes-bearing header still places
  // the gathered handles correctly.
  const [headerCenterY, setHeaderCenterY] = useState(22)
  useLayoutEffect(() => {
    const h = headerRef.current
    if (!h) return
    const measured = h.offsetHeight / 2
    queueMicrotask(() => { setHeaderCenterY(measured) })
  }, [boxInError, data.color, data.collapsed])

  // Keep the box at its expanded width once collapsed — without this the
  // header alone would shrink to its content width and the box "pops"
  // narrower, which looks bad next to the surrounding edges that still
  // anchor at the old width.
  const [expandedWidth, setExpandedWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (collapsed) return
    const box = boxRef.current
    if (!box) return
    const w = box.offsetWidth
    queueMicrotask(() => {
      setExpandedWidth((prev) => (prev === w ? prev : w))
    })
  }, [collapsed, bodyMounted, bodyOpen, left, right])

  // Whether a collapse/expand transition is in progress. Only true between
  // the user's click on the chevron and ANIM_MS later — never during initial
  // mount, scenario load, or any non-toggle re-measurement. The CSS gates
  // the `top` transition on this so handles snap into place outside the
  // animation window instead of sliding every time a row re-lays out.
  //
  // The flag has to flip on synchronously with the `collapsed` prop change,
  // not via a useEffect microtask: a deferred `dispatchAnim(true)` lands
  // AFTER React has already committed the new `top` value, so the CSS sees
  // `data-animating="false"` at the moment `top` changes → no transition. We
  // detect the prop change during render with a ref + set state inline; the
  // setState is gated by the inequality so it doesn't loop. A useEffect
  // schedules the turn-off timer.

  // React Flow caches each handle's position internally for edge routing.
  // When we move the handle DOM (different `top` after a measurement or a
  // collapse), we have to tell the store explicitly — otherwise edges keep
  // pointing at the old positions.
  const updateInternals = useUpdateNodeInternals()
  useEffect(() => { updateInternals(id) }, [id, updateInternals, rowTops, headerCenterY, collapsed])

  // Which input (target) handles currently have an incoming link — drives the
  // red "missing required link" flag on mandatory inputs.
  const targetConnections = useNodeConnections({ id, handleType: 'target' })
  const connectedInputs = useMemo(
    () => new Set(targetConnections.map((c) => c.targetHandle).filter((h): h is string => h != null)),
    [targetConnections]
  )

  const headerStyle: CSSProperties = data.color
    ? { background: data.color, color: getContrastColor(data.color) }
    : {}

  const onToggle = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    // Arm the animation gate synchronously, BEFORE the parent flips
    // `collapsed`. Any other source of a flip (parent hydration, MCP patch,
    // …) arrives without this priming step, so it snaps without animating.
    dispatchAnim(true)
    data.onToggleCollapse?.(id)
  }, [data, id])

  const onHeaderContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    data.onHeaderContextMenu?.(id, e.clientX, e.clientY)
  }, [data, id])

  // Run / cancel the box through the main-process engine. While a run is in
  // flight the button flips to a stop glyph; clicking it then cancels (the
  // in-flight promise's `.finally` clears `running` when it settles).
  const [running, setRunning] = useState(false)
  // The header "!" badge reveals a tooltip listing this box's errors on hover.
  const [showErrors, setShowErrors] = useState(false)
  const errBadgeRef = useRef<HTMLSpanElement>(null)
  const scenarioId = data.scenarioId
  const onPlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!scenarioId || boxInError) return
    const rt = (window as {
      restorm?: {
        runtime?: {
          runScenarioNode?: (scenarioId: string, nodeId: string) => Promise<unknown>
          cancelScenarioNode?: (scenarioId: string, nodeId: string) => Promise<{ cancelled: boolean; reason?: string }>
        }
      }
    }).restorm?.runtime
    if (running) {
      void rt?.cancelScenarioNode?.(scenarioId, id)
      return
    }
    setRunning(true)
    const run = rt?.runScenarioNode?.(scenarioId, id)
    if (run) void run.finally(() => { setRunning(false) })
    else setRunning(false)
  }, [scenarioId, id, running, boxInError])

  return (
    <div
      ref={boxRef}
      className={`scn-node ${selected ? 'scn-node-selected' : ''} ${collapsed ? 'scn-node-collapsed' : ''} ${boxInError ? 'scn-node-error' : ''}`}
      data-testid={`scn-node-${data.kind}`}
      data-animating={animating ? 'true' : 'false'}
      style={collapsed && expandedWidth !== null ? { width: `${expandedWidth}px` } : {}}
    >
      <div ref={headerRef} className={`scn-node-header ${headerEventOutput ? 'scn-node-header-has-event' : ''}`} style={headerStyle} onContextMenu={onHeaderContextMenu}>
        {launchInput && (
          <Handle
            id="in"
            type="target"
            position={Position.Left}
            className={`scn-handle scn-handle-launch ${inputFlowRingClass('in', data.inputs, data.kind)}`}
            style={{ background: anchorColor() }}
            title="in"
          />
        )}
        {headerEventOutput && (
          <Handle
            id="event"
            type="source"
            position={Position.Right}
            className={`scn-handle scn-handle-event ${outputFlowRingClass('event', data.outputs, data.kind)}`}
            style={{ background: anchorColor() }}
            title="event"
          />
        )}
        {headerIcon ?? <i className={`codicon codicon-${meta.icon} scn-node-icon`} aria-hidden="true" />}
        <span className="scn-node-title">{title ?? t(meta.labelKey, meta.defaultLabel)}</span>
        <Button
          small
          secondary
          className="scn-node-collapse nodrag"
          icon={`chevron-${collapsed ? 'right' : 'down'}`}
          onClick={onToggle}
          options={{ ariaLabel: collapsed ? t('scenario.node.expand', 'Expand') : t('scenario.node.collapse', 'Collapse') }}
        />
        {data.status && data.status !== 'idle' && (
          <i className={`codicon codicon-${STATUS_GLYPH[data.status]} scn-node-status scn-node-status-${data.status}`} aria-hidden="true" />
        )}
        {boxInError && (
          <span
            ref={errBadgeRef}
            className="scn-node-errbadge nodrag"
            data-testid="scn-node-error-badge"
            aria-label={t('scenario.validation.showErrors', 'Show errors')}
            onMouseEnter={() => { setShowErrors(true) }}
            onMouseLeave={() => { setShowErrors(false) }}
          >
            <i className="codicon codicon-error" aria-hidden="true" />
          </span>
        )}
        <button
          type="button"
          className={`scn-node-play nodrag ${running ? 'scn-node-play-running' : boxInError ? 'scn-node-play-disabled' : canPlay ? 'scn-node-play-ready' : 'scn-node-play-idle'}`}
          onMouseDown={(e) => { e.stopPropagation() }}
          onClick={onPlay}
          disabled={boxInError}
          aria-label={running ? 'Stop node' : 'Run node'}
          {...(boxInError ? {} : { title: running ? 'Stop node' : 'Run node' })}
        >
          <i className={`codicon codicon-${running ? 'debug-stop' : 'play-circle'}`} aria-hidden="true" />
        </button>
      </div>

      {boxInError && (
        <Tooltip
          targetRef={errBadgeRef}
          show={showErrors}
          placement="below"
          data-testid="scn-node-error-popover"
          onMouseEnter={() => { setShowErrors(true) }}
          onMouseLeave={() => { setShowErrors(false) }}
          content={
            <div className="scn-node-errpopover-body">
              {errors.map((e) => (<div key={e.code} className="scn-node-errpopover-row">{e.message}</div>))}
            </div>
          }
        />
      )}

      {bodyMounted && (
        <div className={`scn-node-collapsible ${bodyOpen ? 'scn-body-open' : ''}`}>
          <div className="scn-node-collapsible-inner">
            {note && (
              <div className="scn-node-notes nodrag">
                <MarkdownViewer value={note} allowMermaid={false} />
              </div>
            )}
            <div className="scn-node-body">
              <div className="scn-node-col scn-node-col-in">
                {left.map((section) => (
                  <ScenarioNodeSection
                    key={section.id}
                    section={section}
                    nodeId={id}
                    connectedInputs={connectedInputs}
                    nodeKind={data.kind}
                    nodeInputs={data.inputs}
                    {...(data.scenarioId !== undefined ? { scenarioId: data.scenarioId } : {})}
                  />
                ))}
              </div>
              <div className="scn-node-col scn-node-col-out">
                {right.map((cell) => (
                  <div className="scn-row scn-row-right" key={cell.id} {...(cell.port ? { 'data-port-id': cell.port.id } : {})}>
                    {cellBody(cell)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single set of port handles — always rendered, absolutely positioned
       * on the box. Their `top` slides between the row centre (expanded) and
       * the header centre (collapsed) via CSS, sequenced after the opacity
       * phase (collapse) or before it (expand). */}
      {allPorts.map((p) => {
        const measured = rowTops.get(p.id)
        const top = collapsed || measured === undefined ? headerCenterY : measured
        return (
          <Handle
            key={p.id}
            id={p.id}
            type={p.type}
            position={p.type === 'target' ? Position.Left : Position.Right}
            className={`scn-handle scn-handle-positioned ${p.type === 'target' ? cellInputRingClass(p, data.inputs, data.kind) : cellOutputRingClass(p, data.outputs, data.kind)}`}
            style={{ top: `${top}px`, background: portAnchorColor(p, connectedInputs) }}
            title={p._label ?? p.id}
          />
        )
      })}

      {hasError !== false && (
        <Handle
          id="error"
          type="source"
          position={Position.Bottom}
          className={`scn-handle scn-handle-error ${outputFlowRingClass('error', data.outputs, data.kind)}`}
          style={{ background: ROLE_COLOR['error'] }}
          title="error"
        />
      )}
    </div>
  )
}

export default ScenarioNodeBoxBase
