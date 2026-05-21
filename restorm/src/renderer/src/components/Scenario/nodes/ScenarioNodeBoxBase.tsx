import React, { useCallback, type CSSProperties, type ReactNode } from 'react'
import { Handle, Position, type Node } from '@xyflow/react'
import { getContrastColor, MarkdownViewer } from 'electron-core-ui/renderer'
import type { ScenarioNodeKind, ScenarioPort, ScenarioPortRole } from '../../../../../shared/types/collections'
import { scenarioNodeMeta } from '../scenarioNodeCatalogue'
import { ROLE_COLOR, handleTop } from '../scenarioGraphMapping'
import { ScenarioNodeSection } from './ScenarioNodeSection'
import { anchorColor, cellBody } from './scenarioCellRender'
import '../ScenarioNodeBox.css'

/** React Flow node data shared by every scenario node box. */
export interface ScenarioNodeBoxData extends Record<string, unknown> {
  kind: ScenarioNodeKind
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
  port?: { id: string; role?: ScenarioPortRole; type: 'target' | 'source' }
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
   * dedicated condition (e.g. one request's `response` → the next's launch).
   * Off for nodes that trigger on a specific input instead (the `if`).
   */
  launchInput?: boolean
  /**
   * Whether the node can be run on its own right now. Drives the header
   * play button's colour: green when runnable, grey otherwise (e.g. an `if`
   * that needs its inputs produced first). Defaults to false.
   */
  canPlay?: boolean
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
export const ScenarioNodeBoxBase: React.FC<ScenarioNodeBoxBaseProps> = ({ id, data, selected, left, right, headerIcon, title, launchInput, canPlay }) => {
  const meta = scenarioNodeMeta(data.kind)
  const collapsed = data.collapsed === true
  const note = data.note
  const leftRows = left.flatMap((s) => s.rows)
  const allPorts = [...leftRows, ...right].flatMap((c) => (c.port ? [c.port] : []))

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

  return (
    <div className={`scn-node ${selected ? 'scn-node-selected' : ''} ${collapsed ? 'scn-node-collapsed' : ''}`} data-testid={`scn-node-${data.kind}`}>
      <div className={`scn-node-header ${launchInput ? 'scn-node-header-has-launch' : ''}`} style={headerStyle} onContextMenu={onHeaderContextMenu}>
        {launchInput && (
          <Handle
            id="in"
            type="target"
            position={Position.Left}
            className="scn-handle scn-handle-launch"
            style={{ background: anchorColor() }}
            title="in"
          />
        )}
        {headerIcon ?? <i className={`codicon codicon-${meta.icon} scn-node-icon`} aria-hidden="true" />}
        <span className="scn-node-title">{title ?? meta.defaultLabel}</span>
        <button type="button" className="scn-node-collapse nodrag" onClick={onToggle} aria-label={collapsed ? 'Expand' : 'Collapse'}>
          <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} aria-hidden="true" />
        </button>
        {data.status && data.status !== 'idle' && (
          <i className={`codicon codicon-${STATUS_GLYPH[data.status]} scn-node-status scn-node-status-${data.status}`} aria-hidden="true" />
        )}
        <button
          type="button"
          className={`scn-node-play nodrag ${canPlay ? 'scn-node-play-ready' : 'scn-node-play-idle'}`}
          onClick={(e) => { e.stopPropagation() }}
          aria-label="Run node"
          title="Run node"
        >
          <i className="codicon codicon-play-circle" aria-hidden="true" />
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
              <ScenarioNodeSection key={section.id} section={section} />
            ))}
          </div>
          <div className="scn-node-col scn-node-col-out">
            {right.map((cell) => (
              <div className="scn-row scn-row-right" key={cell.id}>
                {cellBody(cell)}
                {cell.port && (
                  <Handle id={cell.port.id} type={cell.port.type} position={Position.Right} className="scn-handle scn-handle-inline" style={{ background: anchorColor(cell.port.role) }} title={cell.label ?? cell.port.id} />
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
          className="scn-handle"
          style={{ top: handleTop(i, allPorts.length, true), background: anchorColor(p.role) }}
          title={p.id}
        />
      ))}

      <Handle
        id="error"
        type="source"
        position={Position.Bottom}
        className="scn-handle scn-handle-error"
        style={{ background: ROLE_COLOR['error'] }}
        title="error"
      />
    </div>
  )
}

export default ScenarioNodeBoxBase
