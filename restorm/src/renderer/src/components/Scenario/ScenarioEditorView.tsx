import React, { useMemo, type CSSProperties } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import type { Scenario } from '../../../../shared/types/collections'

export interface ScenarioEditorViewProps {
  /** The scenario being edited. */
  scenario: Scenario
}

const containerStyle: CSSProperties = { width: '100%', height: '100%', position: 'relative' }
const emptyStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  opacity: 0.6,
  fontSize: 13,
  zIndex: 1
}

/**
 * Scenario graph editor surface. Phase 1 renders the scenario's nodes
 * and edges on a pannable / zoomable React Flow canvas (the same stack
 * the documentation model graph uses). Node authoring (palette, the
 * `NodeBox` hierarchy, wiring) lands in subsequent slices — for now the
 * canvas is read-only beyond pan/zoom + node repositioning.
 */
export const ScenarioEditorView: React.FC<ScenarioEditorViewProps> = ({ scenario }) => {
  const { t } = useTranslation()

  const nodes: Node[] = useMemo(
    () =>
      scenario.nodes.map((n) => ({
        id: n.id,
        position: n.position,
        data: { label: n.note ? `${n.kind} — ${n.note}` : n.kind },
        ...(n.color ? { style: { background: n.color } } : {})
      })),
    [scenario.nodes]
  )

  const edges: Edge[] = useMemo(
    () =>
      scenario.edges.map((e) => ({
        id: e.id,
        source: e.from.nodeId,
        target: e.to.nodeId,
        ...(e.color ? { style: { stroke: e.color } } : {})
      })),
    [scenario.edges]
  )

  return (
    <div data-testid="scenario-editor" style={containerStyle}>
      {scenario.nodes.length === 0 && (
        <div data-testid="scenario-editor-empty" style={emptyStyle}>
          {t('scenario.editor.empty', 'Empty scenario — the node palette lands in a later slice')}
        </div>
      )}
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

export default ScenarioEditorView
