import React, { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { ScenarioNodeCell, ScenarioNodeSection as Section } from './ScenarioNodeBoxBase'
import { cellBody, portAnchorColor } from './scenarioCellRender'

function inlineHandle(cell: ScenarioNodeCell, connectedInputs: Set<string>): React.ReactNode {
  if (!cell.port) return null
  return (
    <Handle
      key={cell.port.id}
      id={cell.port.id}
      type={cell.port.type}
      position={Position.Left}
      className="scn-handle scn-handle-inline"
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
export const ScenarioNodeSection: React.FC<{ section: Section; connectedInputs: Set<string> }> = ({ section, connectedInputs }) => {
  const [collapsed, setCollapsed] = useState(false)

  if (!section.name) {
    return (
      <>
        {section.rows.map((cell) => (
          <div className="scn-row scn-row-left" key={cell.id}>
            {inlineHandle(cell, connectedInputs)}
            {cellBody(cell)}
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
        <span className="scn-section-balls">{collapsed ? portRows.map((cell) => inlineHandle(cell, connectedInputs)) : null}</span>
        <span className="scn-section-title">{section.name}</span>
        <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'} scn-section-chevron`} aria-hidden="true" />
      </div>
      {!collapsed && (
        <div className="scn-section-rows">
          {section.rows.map((cell) => (
            <div className="scn-row scn-row-left" key={cell.id}>
              {inlineHandle(cell, connectedInputs)}
              {cellBody(cell)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ScenarioNodeSection
