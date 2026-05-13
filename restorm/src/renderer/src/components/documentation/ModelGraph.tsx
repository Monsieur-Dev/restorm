import React, { useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  useReactFlow,
  useStore,
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

export interface ModelGraphHandle {
  /** Pan + zoom the canvas so the named model node is centred. */
  focusModel: (name: string) => void
}

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
// Padding the auto-fit shares with the Fit View Controls button so
// the very first display matches what the user gets when they
// click Fit View afterwards. Anything else produces a visible
// "snap" the first time the user reaches for the button.
const FIT_VIEW_PADDING = 0.1
const FIT_VIEW_OPTIONS = { padding: FIT_VIEW_PADDING } as const

/**
 * UML-style class diagram of every model the documentation host
 * decides to surface. React Flow handles zoom/pan/minimap and node
 * dragging; ELK provides the initial layered layout with proper
 * edge routing (orthogonal bends, no edge-through-node violations,
 * cycle handling via feedback-edge selection).
 */
export const ModelGraph = React.forwardRef<ModelGraphHandle, ModelGraphProps>(
  ({ models, testId }, ref) => {
    return (
      <div
        className="documentation-host-model-graph"
        data-testid={testId ?? 'documentation-host-model-graph'}
      >
        <ReactFlowProvider>
          <ModelGraphCanvas models={models} forwardedRef={ref} />
        </ReactFlowProvider>
      </div>
    )
  }
)
ModelGraph.displayName = 'ModelGraph'

const ModelGraphCanvas: React.FC<{
  models: ModelDocumentation[]
  forwardedRef: React.ForwardedRef<ModelGraphHandle>
}> = ({ models, forwardedRef }) => {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [layoutReady, setLayoutReady] = useState(false)
  const [fitViewGeneration, setFitViewGeneration] = useState(0)
  const { fitView, setCenter, getNode } = useReactFlow()
  // The graph mounts inside a workbench tab body that the parent
  // toggles between `display: none` and visible. While the tab is
  // hidden the wrapper measures 0x0, so a `fitView()` call there
  // would compute a degenerate viewport. Subscribing to the
  // store-tracked viewport size lets us defer the fit until the
  // canvas has its real dimensions — and re-fit the very first
  // time it transitions from 0x0 to something positive.
  const viewportWidth = useStore((s) => s.width)
  const viewportHeight = useStore((s) => s.height)
  // xyflow's `useNodesInitialized()` reads `s.nodesInitialized`,
  // a flag that's only updated when `setNodes` is called — it
  // captures whether nodes had `measured.{width,height}` at that
  // moment, and is never refreshed once the ResizeObserver fills
  // those fields in. Inside a tab that mounts hidden, `setNodes`
  // always runs before measurement → the flag stays false forever
  // and our auto-fit never fires. Walk the live lookup ourselves
  // so we observe the real measured state on every store wake.
  const nodesReady = useStore((s) => {
    if (s.nodeLookup.size === 0) return false
    for (const [, n] of s.nodeLookup) {
      if (!n.measured.width || !n.measured.height) return false
    }
    return true
  })
  // Each laid-out generation gets at most one auto-fit (once the
  // viewport is actually sized). Without this latch, the effect
  // would re-fire on every container resize and reset whatever pan
  // / zoom the user has manually applied since the last layout.
  const fittedGenerationRef = useRef<number>(-1)

  useEffect(() => {
    let cancelled = false
    void buildModelGraphElements(models).then((result) => {
      if (cancelled) return
      setNodes(result.nodes)
      setEdges(result.edges)
      setLayoutReady(true)
      setFitViewGeneration((n) => n + 1)
    })
    return (): void => {
      cancelled = true
    }
  }, [models])

  // Call fitView twice — back-to-back — because xyflow's first
  // fitView after a fresh layout reads a slightly stale bounding
  // box (the previous viewport transform leaks into the rendered
  // node rects it samples), so the user sees a different result
  // on the *second* press of the Fit View button. The second
  // call within the same micro-task forces convergence on the
  // intended target, so clicking the Fit View button later is a
  // no-op rather than a visible snap.
  useEffect(() => {
    if (!nodesReady) return
    if (nodes.length === 0) return
    if (viewportWidth <= 0 || viewportHeight <= 0) return
    if (fittedGenerationRef.current === fitViewGeneration) return
    fittedGenerationRef.current = fitViewGeneration
    void fitView(FIT_VIEW_OPTIONS).then(() => {
      void fitView(FIT_VIEW_OPTIONS)
    })
  }, [nodesReady, fitViewGeneration, nodes.length, viewportWidth, viewportHeight, fitView])

  // Expose a `focusModel(name)` API so cross-references in the
  // operation cards / sidebar can pan + zoom the canvas to the
  // matching node. ELK has already placed each node, so we read
  // its position straight from React Flow's state.
  useImperativeHandle(forwardedRef, () => ({
    focusModel: (name: string): void => {
      const node = getNode(name)
      if (!node) return
      const width = node.measured?.width ?? node.width ?? 0
      const height = node.measured?.height ?? node.height ?? 0
      const cx = node.position.x + width / 2
      const cy = node.position.y + height / 2
      void setCenter(cx, cy, { zoom: 1, duration: 350 })
    }
  }), [getNode, setCenter])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      proOptions={{ hideAttribution: true }}
      // Share the fit-view options with the auto-fit so the
      // Controls button reproduces the same framing the user
      // sees on initial load.
      fitViewOptions={FIT_VIEW_OPTIONS}
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
    </ReactFlow>
  )
}
