import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import type { Scenario, ScenarioNode, ScenarioEdge, ScenarioNodeKind } from '../../../../shared/types/collections'
import { SCENARIO_NODE_CATALOGUE } from './scenarioNodeCatalogue'
import { scenarioEdgeToFlowEdge, flowEdgeToScenarioEdge } from './scenarioGraphMapping'
import { ScenarioNodeBox, type ScenarioNodeBoxData } from './ScenarioNodeBox'

export interface ScenarioEditorViewProps {
  /** The scenario being edited. */
  scenario: Scenario
  /** Persist node/edge edits back to the tree (debounced by the host). */
  onScenarioChange?: (scenarioId: string, patch: { nodes: ScenarioNode[]; edges: Scenario['edges'] }) => void
}

type NodeData = ScenarioNodeBoxData

const nodeTypes = { scenarioNode: ScenarioNodeBox }

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

function toFlowNode(n: ScenarioNode, onToggleCollapse: (id: string) => void): Node<NodeData> {
  return {
    id: n.id,
    type: 'scenarioNode',
    position: n.position,
    data: {
      kind: n.kind,
      inputs: n.inputs,
      outputs: n.outputs,
      onToggleCollapse,
      ...(n.note !== undefined ? { note: n.note } : {}),
      ...(n.color !== undefined ? { color: n.color } : {}),
      ...(n.collapsed !== undefined ? { collapsed: n.collapsed } : {})
    }
  }
}

function toFlowEdge(e: ScenarioEdge): Edge {
  return scenarioEdgeToFlowEdge(e) as Edge
}

const ScenarioEditorCanvas: React.FC<ScenarioEditorViewProps> = ({ scenario, onScenarioChange }) => {
  const { t } = useTranslation()
  const { screenToFlowPosition } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // The authoritative per-node scenario data (config/ports/note/color),
  // keyed by id. React Flow only round-trips id + position; we merge it
  // back from here when persisting so nothing is lost on a move.
  const nodeStore = useRef<Map<string, ScenarioNode>>(new Map())
  // Per-edge scenario data (selector/color) keyed by edge id, merged back
  // on persist (React Flow only round-trips source/target/handles).
  const edgeStore = useRef<Map<string, ScenarioEdge>>(new Map())

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const [palette, setPalette] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)

  const persist = useCallback((flowNodes: Node<NodeData>[], flowEdges: Edge[]) => {
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
    const nextEdges: ScenarioEdge[] = flowEdges.map((fe) =>
      flowEdgeToScenarioEdge(
        { id: fe.id, source: fe.source, target: fe.target, sourceHandle: fe.sourceHandle, targetHandle: fe.targetHandle },
        edgeStore.current.get(fe.id)
      )
    )
    nodeStore.current = new Map(nextNodes.map((n) => [n.id, n]))
    edgeStore.current = new Map(nextEdges.map((e) => [e.id, e]))
    onScenarioChange?.(scenario.id, { nodes: nextNodes, edges: nextEdges })
  }, [onScenarioChange, scenario.id])

  // Toggle a node's collapsed flag; update the live node + persist.
  const onToggleCollapse = useCallback((nodeId: string) => {
    setNodes((curr) => {
      const next = curr.map((fn) =>
        fn.id === nodeId ? { ...fn, data: { ...fn.data, collapsed: !fn.data.collapsed } } : fn
      )
      const prior = nodeStore.current.get(nodeId)
      if (prior) nodeStore.current.set(nodeId, { ...prior, collapsed: !prior.collapsed })
      setEdges((e) => { persist(next, e); return e })
      return next
    })
  }, [setNodes, setEdges, persist])

  // Seed from the scenario whenever the open scenario changes (tab switch).
  useEffect(() => {
    nodeStore.current = new Map(scenario.nodes.map((n) => [n.id, n]))
    edgeStore.current = new Map(scenario.edges.map((e) => [e.id, e]))
    setNodes(scenario.nodes.map((n) => toFlowNode(n, onToggleCollapse)))
    setEdges(scenario.edges.map(toFlowEdge))
  }, [scenario.id, scenario.nodes, scenario.edges, setNodes, setEdges, onToggleCollapse])

  const handleNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    onNodesChange(changes)
    // Persist after position/drag changes settle.
    if (changes.some((c) => c.type === 'position' && c.dragging === false)) {
      setNodes((curr) => { setEdges((e) => { persist(curr, e); return e }); return curr })
    }
  }, [onNodesChange, setNodes, setEdges, persist])

  const handleEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    onEdgesChange(changes)
    if (changes.some((c) => c.type === 'remove')) {
      setNodes((n) => { setEdges((e) => { persist(n, e); return e }); return n })
    }
  }, [onEdgesChange, setNodes, setEdges, persist])

  const onConnect = useCallback((connection: Connection) => {
    const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setEdges((curr) => {
      const next = addEdge({ ...connection, id }, curr)
      setNodes((n) => { persist(n, next); return n })
      return next
    })
  }, [setEdges, setNodes, persist])

  const addNode = useCallback((kind: ScenarioNodeKind, flow: { x: number; y: number }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const node: ScenarioNode = { id, kind, config: {}, inputs: [], outputs: [], position: flow }
    nodeStore.current.set(id, node)
    setNodes((curr) => {
      const next = [...curr, toFlowNode(node, onToggleCollapse)]
      setEdges((e) => { persist(next, e); return e })
      return next
    })
    setPalette(null)
  }, [setNodes, setEdges, persist, onToggleCollapse])

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
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => { setPalette(null) }}
        fitView
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
