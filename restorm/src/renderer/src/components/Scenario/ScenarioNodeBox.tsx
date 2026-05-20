import React, { useCallback, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { getContrastColor } from 'electron-core-ui/renderer'
import type { ScenarioNodeKind, ScenarioPort } from '../../../../shared/types/collections'
import { scenarioNodeMeta } from './scenarioNodeCatalogue'
import { ROLE_COLOR, portColor, handleTop } from './scenarioGraphMapping'
import './ScenarioNodeBox.css'

export interface ScenarioNodeBoxData extends Record<string, unknown> {
  kind: ScenarioNodeKind
  note?: string
  color?: string
  collapsed?: boolean
  inputs: ScenarioPort[]
  outputs: ScenarioPort[]
  /** Run status for the live-execution overlay (Phase 2); drives the badge. */
  status?: 'idle' | 'running' | 'ok' | 'error'
  onToggleCollapse?: (id: string) => void
}

export type ScenarioNodeBoxType = Node<ScenarioNodeBoxData, 'scenarioNode'>

const STATUS_GLYPH: Record<NonNullable<ScenarioNodeBoxData['status']>, string> = {
  idle: '',
  running: 'sync',
  ok: 'pass-filled',
  error: 'error'
}

/**
 * Base node box for the scenario editor (epic §5b). Shared chrome for
 * every kind: a header (kind icon + label + collapse toggle + optional
 * status badge), role-coloured input/output port handles, and an error
 * port. Collapsed shows the header only, with the ports as small handles
 * on its edges (ids preserved so edges stay attached). Box colour is
 * user-set; the text auto-contrasts via ECUI's `getContrastColor`.
 */
export const ScenarioNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const meta = scenarioNodeMeta(data.kind)
  const collapsed = data.collapsed === true
  const inputs = data.inputs.length > 0 ? data.inputs : [{ id: 'in', name: '', dataType: 'any' as const }]
  const outputs = data.outputs.length > 0 ? data.outputs : [{ id: 'out', name: '', dataType: 'any' as const, role: 'response' as const }]

  const headerStyle: CSSProperties = data.color
    ? { background: data.color, color: getContrastColor(data.color) }
    : {}

  const onToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    data.onToggleCollapse?.(id)
  }, [data, id])

  return (
    <div className={`scn-node ${selected ? 'scn-node-selected' : ''} ${collapsed ? 'scn-node-collapsed' : ''}`} data-testid={`scn-node-${data.kind}`}>
      <div className="scn-node-header" style={headerStyle}>
        <i className={`codicon codicon-${meta.icon} scn-node-icon`} aria-hidden="true" />
        <span className="scn-node-title">{meta.defaultLabel}{data.note ? ` — ${data.note}` : ''}</span>
        {data.status && data.status !== 'idle' && (
          <i className={`codicon codicon-${STATUS_GLYPH[data.status]} scn-node-status scn-node-status-${data.status}`} aria-hidden="true" />
        )}
        <button type="button" className="scn-node-collapse" onClick={onToggle} aria-label={collapsed ? 'Expand' : 'Collapse'}>
          <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} aria-hidden="true" />
        </button>
      </div>

      {/* Input handles (left edge) */}
      {inputs.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          className="scn-handle"
          style={{ top: handleTop(i, inputs.length, collapsed), background: portColor(p) }}
          title={p.name || p.id}
        />
      ))}

      {/* Output handles (right edge) */}
      {outputs.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={Position.Right}
          className="scn-handle"
          style={{ top: handleTop(i, outputs.length, collapsed), background: portColor(p) }}
          title={p.name || p.id}
        />
      ))}

      {/* Dedicated error port (bottom). Wireable rescue branch (epic §4). */}
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

export default ScenarioNodeBox
