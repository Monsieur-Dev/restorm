import React, { useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'
import { ModelNode } from './ModelNode'
import { ModelEdge } from './ModelEdge'
import { buildModelGraphElements } from './modelGraphLayout'

export interface ModelGraphProps {
  /** Deduplicated list of models to render, already filtered by the
   * parent host. The graph draws every cross-model edge declared via
   * `targetModelRef` whose target is also present in this list —
   * dangling refs are silently skipped. */
  models: ModelDocumentation[]
  /** Optional test id stamped on the React Flow container. */
  testId?: string
}

const NODE_TYPES: NodeTypes = { umlClass: ModelNode }
const EDGE_TYPES: EdgeTypes = { modelEdge: ModelEdge }

/**
 * UML-style class diagram of every model the documentation host
 * decides to surface. React Flow handles zoom/pan/minimap and node
 * dragging; ELK provides the initial layered layout with proper
 * edge routing (orthogonal bends, no edge-through-node violations,
 * cycle handling via feedback-edge selection).
 */
export const ModelGraph: React.FC<ModelGraphProps> = ({ models, testId }) => {
  return (
    <div
      className="documentation-host-model-graph"
      data-testid={testId ?? 'documentation-host-model-graph'}
    >
      <ReactFlowProvider>
        <ModelGraphCanvas models={models} />
      </ReactFlowProvider>
    </div>
  )
}

const ModelGraphCanvas: React.FC<{ models: ModelDocumentation[] }> = ({ models }) => {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [layoutReady, setLayoutReady] = useState(false)
  const { fitView } = useReactFlow()

  useEffect(() => {
    let cancelled = false
    void buildModelGraphElements(models).then((result) => {
      if (cancelled) return
      setNodes(result.nodes)
      setEdges(result.edges)
      setLayoutReady(true)
      // Defer the fit-view until after React commits the new
      // node positions; without the rAF the call runs before
      // React Flow has measured the freshly-laid-out nodes.
      requestAnimationFrame(() => {
        void fitView({ padding: 0.2 })
      })
    })
    return (): void => {
      cancelled = true
    }
  }, [models, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
      maxZoom={2}
      // Wheel passes through to the page so the documentation
      // surface scrolls naturally even when the cursor sits over
      // the canvas. With `zoomActivationKeyCode` set, the wheel
      // only zooms while Ctrl/Cmd is held — plain wheel events
      // bubble to the outer ScrollableElement.
      panOnScroll={false}
      zoomOnScroll
      zoomActivationKeyCode={['Control', 'Meta']}
      zoomOnPinch
      preventScrolling={false}
      // Drag the viewport from anywhere — including over a node —
      // when the user holds the mouse button. Combined with
      // `nodesDraggable={false}`, this means click-drag on a node
      // moves the camera, not the node, so the user can pan
      // without aiming for empty space.
      panOnDrag
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      // React Flow registers a window-level key handler that
      // hijacks Space (default `panActivationKeyCode`) and
      // Backspace / Delete (`deleteKeyCode`). When this graph is
      // mounted inside a hidden Tabs panel — e.g. the request's
      // Docs tab while the user is typing in the URL Monaco —
      // those shortcuts still fire on the renderer-wide window,
      // swallowing keystrokes the user expects to land in the
      // active editor. Disable the graph-level shortcuts entirely
      // — the doc viewer is read-only, so we never need them.
      panActivationKeyCode={null}
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      data-layout-ready={layoutReady ? 'true' : 'false'}
    >
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  )
}
