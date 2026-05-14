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
  const { fitView, setCenter, getNode, getViewport, setViewport } = useReactFlow()
  const reactFlowWrapperRef = useRef<HTMLDivElement | null>(null)
  // Pan with cursor invisibility via Pointer Lock — solves the
  // "popover closes mid-drag" problem when the model graph lives
  // inside a tooltip / popover. xyflow's built-in d3-zoom pan reads
  // `clientX/Y`, which freezes once the pointer is locked, so we
  // disable `panOnDrag` and drive the viewport ourselves from the
  // `movementX/Y` deltas that pointer-lock still delivers. As a
  // side benefit, the cursor disappears for the duration of the
  // drag (the user explicitly asked for this — it makes the
  // limitlessly-large canvas feel less constrained by the popover
  // bounds).
  const isPanningRef = useRef(false)
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

  // Pointer-lock pan: replaces xyflow's `panOnDrag` (which reads
  // `clientX/Y` through d3-zoom — those freeze the moment we lock
  // the pointer). We capture `pointerdown` on the React Flow pane,
  // request lock, accumulate `movementX/Y` deltas into the
  // viewport, and release on `pointerup`. While locked, the
  // cursor is invisible and pinned, so the user can drag the
  // canvas an arbitrary distance without the surrounding popover
  // ever registering a `mouseleave` and closing.
  useEffect(() => {
    const wrapper = reactFlowWrapperRef.current
    if (!wrapper) return
    const pane = wrapper.querySelector<HTMLElement>('.react-flow__pane')
    if (!pane) return

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const target = e.target
      if (!(target instanceof Element)) return
      // Only kick in on the empty pane (not on a node, edge label,
      // or the Controls bar). The pane is the largest clickable
      // child of React Flow; if the user clicked anywhere else,
      // we let the default handler run (e.g. zoom/fit buttons).
      if (target.closest('.react-flow__controls')) return
      if (target.closest('.react-flow__minimap')) return
      isPanningRef.current = true
      // Capture the pointer so move/up events stay routed to the
      // pane even when the physical cursor would leave its bounds
      // — this is what keeps the surrounding popover from closing
      // mid-drag. Pointer Lock layers on top to make the cursor
      // disappear + freeze in place. If the lock request is denied
      // (e.g. document isn't focused), the capture still handles
      // the "drag past the edge" case, just with a visible cursor.
      try {
        pane.setPointerCapture(e.pointerId)
      } catch {
        // Some hosts reject setPointerCapture if the pointer is
        // released between the test and the call — non-fatal.
      }
      const lockResult = pane.requestPointerLock() as Promise<void> | undefined
      if (lockResult && typeof lockResult.catch === 'function') {
        lockResult.catch(() => { /* keep panning via setPointerCapture */ })
      }
      e.preventDefault()
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!isPanningRef.current) return
      // `movementX/Y` is the delta from the previous event
      // regardless of whether the pointer is locked, so the pan
      // works identically in both cases. Without pointer lock the
      // cursor remains visible but `setPointerCapture` keeps
      // mousemove events flowing past the popover boundary.
      const vp = getViewport()
      void setViewport({
        x: vp.x + e.movementX,
        y: vp.y + e.movementY,
        zoom: vp.zoom
      })
    }

    const endPan = (e?: PointerEvent): void => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      if (document.pointerLockElement === pane) {
        document.exitPointerLock()
      }
      if (e && pane.hasPointerCapture(e.pointerId)) {
        pane.releasePointerCapture(e.pointerId)
      }
    }

    pane.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', endPan)
    // `pointerlockchange` fires when the user presses Escape (the
    // browser-imposed unlock shortcut) — clear our flag so the
    // next mousedown re-locks instead of thinking we're still
    // dragging.
    const onLockChange = (): void => {
      if (document.pointerLockElement !== pane) {
        isPanningRef.current = false
      }
    }
    document.addEventListener('pointerlockchange', onLockChange)

    return (): void => {
      pane.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', endPan)
      document.removeEventListener('pointerlockchange', onLockChange)
      if (document.pointerLockElement === pane) {
        document.exitPointerLock()
      }
    }
  }, [getViewport, setViewport, layoutReady])

  return (
    <div
      ref={reactFlowWrapperRef}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
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
      // Disable xyflow's built-in pan — we drive panning ourselves
      // via Pointer Lock + `movementX/Y` (see the effect above).
      // Leaving this on would race with our custom handler and
      // produce double-applied deltas.
      panOnDrag={false}
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
    </div>
  )
}
