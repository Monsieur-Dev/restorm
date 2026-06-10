import React, { useState } from 'react'
import type { ScenarioNodeKind, ScenarioPort } from '../../../../../shared/types/collections'
import type { ScenarioNodeCell, ScenarioNodeSection as Section } from './ScenarioNodeBoxBase'
import { ScenarioInputCell } from './ScenarioInputCell'

/**
 * One section of a node's left column. A blank `name` renders the rows flat
 * (no header). A named section is a collapsible panel: when expanded each
 * row carries a `data-port-id` marker; when collapsed the rows hide and the
 * marker moves to the section title row, so the box-level handle layout
 * picks up the new anchor row and slides the handles accordingly.
 *
 * Note: handles themselves are NOT rendered here — `ScenarioNodeBoxBase`
 * renders a single set of absolute-positioned `<Handle>` siblings of the
 * body and measures each row's centre via the `data-port-id` markers. That
 * keeps box-level collapse animations smooth (single DOM node morphing top)
 * and avoids duplicate React Flow handles for the same port id.
 */
export const ScenarioNodeSection: React.FC<{
  section: Section
  nodeId: string
  connectedInputs: Set<string>
  nodeKind: ScenarioNodeKind
  nodeInputs: ScenarioPort[]
  scenarioId?: string
}> = ({ section, nodeId, nodeKind, nodeInputs, scenarioId }) => {
  const [collapsed, setCollapsed] = useState(false)

  const renderCell = (cell: ScenarioNodeCell): React.ReactNode => (
    <ScenarioInputCell cell={cell} nodeId={nodeId} nodeKind={nodeKind} nodeInputs={nodeInputs} {...(scenarioId !== undefined ? { scenarioId } : {})} />
  )

  if (!section.name) {
    return (
      <>
        {section.rows.map((cell) => (
          <div className="scn-row scn-row-left" key={cell.id} {...(cell.port ? { 'data-port-id': cell.port.id } : {})}>
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
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setCollapsed((c) => !c) } }}
      >
        {/* When the section is collapsed, the port-id markers move here so
         * the box-level layout pass anchors the handles to the title row. */}
        {collapsed && portRows.map((cell) => (
          cell.port ? <span key={cell.port.id} className="scn-section-ball" data-port-id={cell.port.id} /> : null
        ))}
        <span className="scn-section-title">{section.name}</span>
        <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'} scn-section-chevron`} aria-hidden="true" />
      </div>
      {!collapsed && (
        <div className="scn-section-rows">
          {section.rows.map((cell) => (
            <div className="scn-row scn-row-left" key={cell.id} {...(cell.port ? { 'data-port-id': cell.port.id } : {})}>
              {renderCell(cell)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ScenarioNodeSection
