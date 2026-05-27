import React, { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Handle, Position, useNodeConnections, type Node } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { getContrastColor, MarkdownViewer } from 'electron-core-ui/renderer'
import type { ScenarioNodeKind, ScenarioPort, ScenarioPortRole } from '../../../../../shared/types/collections'
import { scenarioNodeMeta } from '../scenarioNodeCatalogue'
import { ROLE_COLOR, handleTop } from '../scenarioGraphMapping'
import { ScenarioNodeSection } from './ScenarioNodeSection'
import { anchorColor, cellBody, portAnchorColor, inputFlowRingClass, outputFlowRingClass } from './scenarioCellRender'
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
  port?: { id: string; role?: ScenarioPortRole; type: 'target' | 'source'; required?: boolean; orphan?: boolean }
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
  const collapsed = data.collapsed === true
  const note = data.note
  const leftRows = left.flatMap((s) => s.rows)
  const allPorts = [...leftRows, ...right].flatMap((c) => (c.port ? [c.port] : []))

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

  const onToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
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
  const scenarioId = data.scenarioId
  const onPlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!scenarioId) return
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
  }, [scenarioId, id, running])

  return (
    <div className={`scn-node ${selected ? 'scn-node-selected' : ''} ${collapsed ? 'scn-node-collapsed' : ''}`} data-testid={`scn-node-${data.kind}`}>
      <div className={`scn-node-header ${launchInput ? 'scn-node-header-has-launch' : ''} ${headerEventOutput ? 'scn-node-header-has-event' : ''}`} style={headerStyle} onContextMenu={onHeaderContextMenu}>
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
        <button type="button" className="scn-node-collapse nodrag" onClick={onToggle} aria-label={collapsed ? 'Expand' : 'Collapse'}>
          <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} aria-hidden="true" />
        </button>
        {data.status && data.status !== 'idle' && (
          <i className={`codicon codicon-${STATUS_GLYPH[data.status]} scn-node-status scn-node-status-${data.status}`} aria-hidden="true" />
        )}
        <button
          type="button"
          className={`scn-node-play nodrag ${running ? 'scn-node-play-running' : canPlay ? 'scn-node-play-ready' : 'scn-node-play-idle'}`}
          onMouseDown={(e) => { e.stopPropagation() }}
          onClick={onPlay}
          aria-label={running ? 'Stop node' : 'Run node'}
          title={running ? 'Stop node' : 'Run node'}
        >
          <i className={`codicon codicon-${running ? 'debug-stop' : 'play-circle'}`} aria-hidden="true" />
        </button>
      </div>

      {!collapsed && note && (
        <div className="scn-node-notes nodrag">
          <MarkdownViewer value={note} allowMermaid={false} />
        </div>
      )}

      {!collapsed && (
        <div className="scn-node-body">
          <div className="scn-node-col scn-node-col-in">
            {left.map((section) => (
              <ScenarioNodeSection
                key={section.id}
                section={section}
                connectedInputs={connectedInputs}
                nodeKind={data.kind}
                nodeInputs={data.inputs}
                {...(data.scenarioId !== undefined ? { scenarioId: data.scenarioId } : {})}
              />
            ))}
          </div>
          <div className="scn-node-col scn-node-col-out">
            {right.map((cell) => (
              <div className="scn-row scn-row-right" key={cell.id}>
                {cellBody(cell)}
                {cell.port && (
                  <Handle id={cell.port.id} type={cell.port.type} position={Position.Right} className={`scn-handle scn-handle-inline ${outputFlowRingClass(cell.port.id, data.outputs, data.kind)}`} style={{ background: portAnchorColor(cell.port, connectedInputs) }} title={cell.label ?? cell.port.id} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {collapsed && allPorts.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type={p.type}
          position={p.type === 'target' ? Position.Left : Position.Right}
          className={`scn-handle ${p.type === 'target' ? inputFlowRingClass(p.id, data.inputs, data.kind) : outputFlowRingClass(p.id, data.outputs, data.kind)}`}
          style={{ top: handleTop(i, allPorts.length, true), background: portAnchorColor(p, connectedInputs) }}
          title={p.id}
        />
      ))}

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
