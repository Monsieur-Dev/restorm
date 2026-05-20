import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import type { Scenario, ScenarioNode, ScenarioNodeKind } from '../../../../shared/types/collections'
import { SCENARIO_NODE_CATALOGUE, scenarioNodeMeta } from './scenarioNodeCatalogue'

export interface ScenarioEditorViewProps {
  /** The scenario being edited. */
  scenario: Scenario
  /** Persist node/edge edits back to the tree (debounced by the host). */
  onScenarioChange?: (scenarioId: string, patch: { nodes: ScenarioNode[]; edges: Scenario['edges'] }) => void
}

interface NodeData extends Record<string, unknown> {
  kind: ScenarioNodeKind
  label: string
}

const containerStyle: CSSProperties = { width: '100%', height: '100%', position: 'relative' }
const emptyStyle: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  pointerEvents: 'none', opacity: 0.6, fontSize: 13, zIndex: 1
}
const paletteStyle: CSSProperties = {
  position: 'absolute', zIndex: 10, maxHeight: 360, overflowY: 'auto', minWidth: 200,
  background: 'var(--ecu-menu-background, #252526)', border: '1px solid var(--ecu-menu-border, #454545)',
  borderRadius: 4, padding: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: 1
}

function toFlowNode(n: ScenarioNode): Node<NodeData> {
  const meta = scenarioNodeMeta(n.kind)
  return {
    id: n.id,
    position: n.position,
    data: { kind: n.kind, label: n.note ? `${meta.defaultLabel} — ${n.note}` : meta.defaultLabel },
    ...(n.color ? { style: { background: n.color } } : {})
  }
}

const ScenarioEditorCanvas: React.FC<ScenarioEditorViewProps> = ({ scenario, onScenarioChange }) => {
  const { t } = useTranslation()
  const { screenToFlowPosition } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // The authoritative per-node scenario data (config/ports/note/color),
  // keyed by id. React Flow only round-trips id + position; we merge it
  // back from here when persisting so nothing is lost on a move.
  const nodeStore = useRef<Map<string, ScenarioNode>>(new Map())

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([])
  const [edges, , onEdgesChange] = useEdgesState([])
  const [palette, setPalette] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)

  // Seed from the scenario whenever the open scenario changes (tab switch).
  useEffect(() => {
    nodeStore.current = new Map(scenario.nodes.map((n) => [n.id, n]))
    setNodes(scenario.nodes.map(toFlowNode))
  }, [scenario.id, scenario.nodes, setNodes])

  const persist = useCallback((flowNodes: Node<NodeData>[]) => {
    const nextNodes: ScenarioNode[] = flowNodes.map((fn) => {
      const prior = nodeStore.current.get(fn.id)
      return {
        id: fn.id,
        kind: fn.data.kind,
        config: prior?.config ?? {},
        inputs: prior?.inputs ?? [],
        outputs: prior?.outputs ?? [],
        position: fn.position,
        ...(prior?.note !== undefined ? { note: prior.note } : {}),
        ...(prior?.color !== undefined ? { color: prior.color } : {}),
        ...(prior?.collapsed !== undefined ? { collapsed: prior.collapsed } : {})
      }
    })
    nodeStore.current = new Map(nextNodes.map((n) => [n.id, n]))
    onScenarioChange?.(scenario.id, { nodes: nextNodes, edges: scenario.edges })
  }, [onScenarioChange, scenario.id, scenario.edges])

  const handleNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    onNodesChange(changes)
    // Persist after position/drag changes settle.
    if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
      setNodes((curr) => { persist(curr); return curr })
    }
  }, [onNodesChange, setNodes, persist])

  const addNode = useCallback((kind: ScenarioNodeKind, flow: { x: number; y: number }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const node: ScenarioNode = { id, kind, config: {}, inputs: [], outputs: [], position: flow }
    nodeStore.current.set(id, node)
    setNodes((curr) => {
      const next = [...curr, toFlowNode(node)]
      persist(next)
      return next
    })
    setPalette(null)
  }, [setNodes, persist])

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    const clientX = 'clientX' in event ? event.clientX : 0
    const clientY = 'clientY' in event ? event.clientY : 0
    setPalette({
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
      flow: screenToFlowPosition({ x: clientX, y: clientY })
    })
  }, [screenToFlowPosition])

  return (
    <div ref={wrapperRef} data-testid="scenario-editor" style={containerStyle}>
      {nodes.length === 0 && (
        <div data-testid="scenario-editor-empty" style={emptyStyle}>
          {t('scenario.editor.empty', 'Empty scenario — right-click the canvas to add a node')}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => { setPalette(null) }}
        fitView
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      {palette && (
        <div data-testid="scenario-node-palette" style={{ ...paletteStyle, left: palette.x, top: palette.y }}>
          {SCENARIO_NODE_CATALOGUE.map((meta) => (
            <Button
              key={meta.kind}
              small
              fullWidth
              align="left"
              icon={meta.icon}
              data-testid={`scenario-palette-${meta.kind}`}
              onClick={() => { addNode(meta.kind, palette.flow) }}
            >
              {t(meta.labelKey, meta.defaultLabel)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Scenario graph editor surface. Renders the dataflow graph on a React
 * Flow canvas (same stack as the documentation model graph) and lets the
 * user add nodes via a right-click palette (epic gesture #2). Edits are
 * persisted back through `onScenarioChange`. Edge wiring + the styled
 * NodeBox hierarchy + the remaining add-node gestures land next.
 */
export const ScenarioEditorView: React.FC<ScenarioEditorViewProps> = (props) => (
  <ReactFlowProvider>
    <ScenarioEditorCanvas {...props} />
  </ReactFlowProvider>
)

export default ScenarioEditorView
