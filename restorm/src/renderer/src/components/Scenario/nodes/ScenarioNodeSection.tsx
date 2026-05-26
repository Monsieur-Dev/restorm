import React, { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { ScenarioNodeKind, ScenarioPort } from '../../../../../shared/types/collections'
import type { ScenarioNodeCell, ScenarioNodeSection as Section } from './ScenarioNodeBoxBase'
import { portAnchorColor, inputFlowRingClass } from './scenarioCellRender'
import { ScenarioInputCell } from './ScenarioInputCell'

function inlineHandle(cell: ScenarioNodeCell, connectedInputs: Set<string>, nodeInputs: ScenarioPort[], nodeKind: ScenarioNodeKind): React.ReactNode {
  if (!cell.port) return null
  return (
    <Handle
      key={cell.port.id}
      id={cell.port.id}
      type={cell.port.type}
      position={Position.Left}
      className={`scn-handle scn-handle-inline ${inputFlowRingClass(cell.port.id, nodeInputs, nodeKind)}`}
      style={{ background: portAnchorColor(cell.port, connectedInputs) }}
      title={cell.label ?? cell.port.id}
    />
  )
}

/**
 * One section of a node's left column. A blank `name` renders the rows flat
 * (no header). A named section is a collapsible panel: when expanded each
 * row carries its own anchor; when collapsed the rows hide and their anchors
 * gather on the section title row (the handles stay mounted so edges hold).
 */
export const ScenarioNodeSection: React.FC<{
  section: Section
  connectedInputs: Set<string>
  nodeKind: ScenarioNodeKind
  nodeInputs: ScenarioPort[]
  scenarioId?: string
}> = ({ section, connectedInputs, nodeKind, nodeInputs, scenarioId }) => {
  const [collapsed, setCollapsed] = useState(false)

  const renderCell = (cell: ScenarioNodeCell): React.ReactNode => (
    <ScenarioInputCell cell={cell} nodeKind={nodeKind} nodeInputs={nodeInputs} {...(scenarioId !== undefined ? { scenarioId } : {})} />
  )

  if (!section.name) {
    return (
      <>
        {section.rows.map((cell) => (
          <div className="scn-row scn-row-left" key={cell.id}>
            {inlineHandle(cell, connectedInputs, nodeInputs, nodeKind)}
            {renderCell(cell)}
          </div>
        ))}
      </>
    )
  }

  const portRows = section.rows.filter((r) => r.port)
  return (
    <div className={`scn-section ${collapsed ? 'scn-section-collapsed' : ''}`}>
      <div
        className="scn-section-header nodrag"
        onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c) }}
      >
        <span className="scn-section-balls">{collapsed ? portRows.map((cell) => inlineHandle(cell, connectedInputs, nodeInputs, nodeKind)) : null}</span>
        <span className="scn-section-title">{section.name}</span>
        <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'} scn-section-chevron`} aria-hidden="true" />
      </div>
      {!collapsed && (
        <div className="scn-section-rows">
          {section.rows.map((cell) => (
            <div className="scn-row scn-row-left" key={cell.id}>
              {inlineHandle(cell, connectedInputs, nodeInputs, nodeKind)}
              {renderCell(cell)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ScenarioNodeSection
