/**
 * GraphCanvas — the one node-graph surface for the whole app.
 *
 * Wraps `@xyflow/react`'s `<ReactFlow>` with a single, consistently
 * themed control cluster (zoom in / zoom out / fit-to-view, plus an
 * optional minimap + minimap toggle) and three ready-made panning
 * presets, so every graph in a consuming app looks + behaves the
 * same way.
 *
 * What this component owns (and why it's shared):
 * - **Surface + viewport**: the `<ReactFlowProvider>` + `<ReactFlow>`
 *   pair, the dotted `Background` grid, fit-view / default-viewport
 *   wiring.
 * - **Control cluster**: React Flow's `Controls` bar, restyled via
 *   `graphCanvas.css` (dark panel, codicon-tinted icons) so the zoom /
 *   fit / minimap buttons read identically on every theme. An optional
 *   minimap toggle button is appended at the bottom of the stack.
 * - **Panning presets** (`panMode`): the three drag/zoom behaviours the
 *   app needs, including the popover-safe pointer-lock pan that used to
 *   be copy-pasted into each read-only graph.
 *
 * What it deliberately does NOT own: any app-specific node/edge logic.
 * The consumer passes `nodes` / `edges` / `nodeTypes` / `edgeTypes` and
 * every React Flow handler it needs; `reactFlowProps` is spread LAST so
 * a consumer can override anything (the scenario editor wires its perf
 * culling, context menus, selection-on-drag, etc. that way without this
 * component knowing about them).
 *
 * @example
 * ```tsx
 * import { GraphCanvas } from 'electron-core-ui/renderer'
 *
 * <GraphCanvas
 *   nodes={nodes}
 *   edges={edges}
 *   nodeTypes={NODE_TYPES}
 *   panMode="pointerLock"
 *   minimap={{ nodeColor: 'var(--focusBorder)' }}
 * />
 * ```
 */

import React, { useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type MiniMapProps,
  type Node,
  type NodeTypes,
  type ReactFlowProps,
  type Viewport
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './graphCanvas.css'

/** How dragging the canvas pans it (and how the wheel zooms). */
export type GraphCanvasPanMode =
  /**
   * Live-editor feel: left-drag box-selects (`selectionOnDrag`),
   * middle mouse drags the canvas (`panOnDrag={[1]}`), and the
   * Shift-selection key is disabled (`selectionKeyCode={null}`) — that
   * last bit avoids React Flow's window-level Shift `preventDefault`,
   * which on Linux swallows the first uppercase letter typed into any
   * input on the page. Plain wheel zooms.
   */
  | 'editor'
  /**
   * Plain React Flow drag-pan + plain-wheel zoom. Good for a docked,
   * read-only panel with no surrounding popover to keep alive.
   */
  | 'classic'
  /**
   * Popover-safe pan: React Flow's own `panOnDrag` is OFF and we drive
   * the viewport from Pointer-Lock `movementX/Y` deltas instead. The
   * cursor disappears for the drag, so a hover popover hosting the graph
   * never registers a `mouseleave` mid-pan and stays open. The wheel
   * only zooms while Ctrl/⌘ is held, so a stray wheel inside the bubble
   * scrolls the page rather than zooming.
   */
  | 'pointerLock'
  /**
   * Inert thumbnail: no pan, no zoom, no controls. Used for static
   * fit-to-view previews.
   */
  | 'static'

/** Minimap options — the subset of React Flow `MiniMapProps` a
 * consumer realistically tunes. `false` (the default) hides it. */
export interface GraphCanvasMinimapOptions {
  nodeColor?: MiniMapProps['nodeColor']
  maskColor?: MiniMapProps['maskColor']
  pannable?: boolean
  zoomable?: boolean
}

/** Background grid options. `false` hides the grid entirely. */
export interface GraphCanvasBackgroundOptions {
  gap?: number
  offset?: number
  /** Unique pattern id — React Flow derives its `<pattern>` id from
   * this, so several mounted canvases need distinct ids or the grid
   * goes blank (shared `url(#pattern-…)` resolves to the first, often
   * a hidden 0×0 instance). */
  id?: string
}

export interface GraphCanvasProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> {
  nodes: NodeType[]
  edges: EdgeType[]
  nodeTypes?: NodeTypes
  edgeTypes?: EdgeTypes

  /** Panning / zoom preset. Defaults to `'classic'`. */
  panMode?: GraphCanvasPanMode

  /** Show the zoom / fit control bar. Defaults to `true` (forced off
   * when `panMode === 'static'`). */
  showControls?: boolean
  /** Dotted background grid. `true` uses React Flow defaults; an object
   * tunes gap / offset / id; `false` hides it. Defaults to `false`. */
  background?: boolean | GraphCanvasBackgroundOptions
  /** Minimap. `false` (default) hides it; an object configures it. The
   * minimap shows only when truthy AND (if `minimapToggle`) toggled on. */
  minimap?: false | GraphCanvasMinimapOptions

  /** Render a toggle button at the bottom of the control stack that
   * shows / hides the minimap. The label is passed by the consumer so
   * the library stays locale-free. Requires `minimap` to be set. */
  minimapToggle?: { label: string; testId?: string }
  /** Extra props spread onto the control bar's `<Controls>` — e.g. an
   * `onFitView` override (so the fit-view button can also re-arm a
   * consumer's auto-fit) or `fitViewOptions` for the button's framing. */
  controlsProps?: Partial<React.ComponentProps<typeof Controls>>
  /** Extra control buttons appended after the minimap toggle (the
   * consumer's own `<ControlButton>`s). */
  extraControls?: React.ReactNode

  /** Fit the graph to the viewport on mount. */
  fitView?: boolean
  fitViewOptions?: ReactFlowProps['fitViewOptions']
  /** Initial viewport (e.g. a persisted pan/zoom). Wins over `fitView`. */
  defaultViewport?: Viewport
  minZoom?: number
  maxZoom?: number

  /** Escape hatch — spread LAST onto `<ReactFlow>`, so a consumer can
   * set or override any React Flow prop (handlers, perf flags, …) the
   * presets don't cover. Typed with the consumer's node/edge generics so
   * strongly-typed handlers flow through without casts. */
  reactFlowProps?: Partial<ReactFlowProps<NodeType, EdgeType>>

  /** Slot for app-specific overlays rendered inside `<ReactFlow>`
   * (custom panels, prompts, …) alongside the controls. */
  children?: React.ReactNode

  /** Test id stamped on the canvas wrapper. */
  'data-testid'?: string
}

const PRO_OPTIONS = { hideAttribution: true } as const
const EDITOR_PAN_ON_DRAG = [1]
const MULTI_SELECTION_KEYS = ['Control', 'Meta']
const ZOOM_ACTIVATION_KEYS = ['Control', 'Meta']

/**
 * Pointer-lock pan: replaces React Flow's `panOnDrag` (which reads
 * `clientX/Y` through d3-zoom — those freeze the moment we lock the
 * pointer). Capture `pointerdown` on the pane, request lock, accumulate
 * `movementX/Y` into the viewport, release on `pointerup`. While locked
 * the cursor is invisible + pinned, so the user can drag the canvas any
 * distance without a surrounding popover registering a `mouseleave`.
 */
function usePointerLockPan(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean
): void {
  const { getViewport, setViewport } = useReactFlow()
  const isPanningRef = useRef(false)
  useEffect(() => {
    if (!enabled) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const pane = wrapper.querySelector<HTMLElement>('.react-flow__pane')
    if (!pane) return

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const target = e.target
      if (!(target instanceof Element)) return
      // Let the controls bar, the minimap, and interactive node
      // elements (links, buttons, inputs) get their own clicks.
      if (target.closest('.react-flow__controls')) return
      if (target.closest('.react-flow__minimap')) return
      if (target.closest('button, a, input, select, textarea, [role="button"]')) return
      isPanningRef.current = true
      // Capture keeps move/up routed to the pane even when the cursor
      // would leave its bounds — this is what stops a hosting popover
      // from closing mid-drag. Pointer Lock layers on top to hide +
      // freeze the cursor; if the lock request is denied, the capture
      // still handles "drag past the edge", just with a visible cursor.
      try {
        pane.setPointerCapture(e.pointerId)
      } catch {
        // Some hosts reject setPointerCapture if the pointer was
        // released between the test and the call — non-fatal.
      }
      const lockResult = pane.requestPointerLock() as Promise<void> | undefined
      if (lockResult && typeof lockResult.catch === 'function') {
        lockResult.catch(() => {
          /* keep panning via setPointerCapture */
        })
      }
      e.preventDefault()
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!isPanningRef.current) return
      // `movementX/Y` is the delta from the previous event whether or
      // not the pointer is locked, so panning works the same in both
      // cases.
      const vp = getViewport()
      void setViewport({ x: vp.x + e.movementX, y: vp.y + e.movementY, zoom: vp.zoom })
    }

    const endPan = (e?: PointerEvent): void => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      if (document.pointerLockElement === pane) document.exitPointerLock()
      if (e && pane.hasPointerCapture(e.pointerId)) pane.releasePointerCapture(e.pointerId)
    }

    // Escape unlocks the pointer (browser-imposed shortcut) — clear our
    // flag so the next mousedown re-locks instead of thinking we're
    // still dragging.
    const onLockChange = (): void => {
      if (document.pointerLockElement !== pane) isPanningRef.current = false
    }

    pane.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', endPan)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      pane.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', endPan)
      document.removeEventListener('pointerlockchange', onLockChange)
      if (document.pointerLockElement === pane) document.exitPointerLock()
    }
  }, [wrapperRef, enabled, getViewport, setViewport])
}

/** Translate a `panMode` into the React Flow props that implement it.
 * Returned object is spread BEFORE `reactFlowProps`, so a consumer can
 * still override any individual flag. */
/** The pan/zoom flags a preset sets — deliberately none are node/edge
 * typed, so the result spreads cleanly onto a generic `<ReactFlow>`. */
type PanModeFlags = Pick<
  ReactFlowProps,
  | 'selectionKeyCode'
  | 'selectionOnDrag'
  | 'panOnDrag'
  | 'panOnScroll'
  | 'multiSelectionKeyCode'
  | 'zoomOnScroll'
  | 'zoomOnPinch'
  | 'zoomActivationKeyCode'
  | 'panActivationKeyCode'
  | 'deleteKeyCode'
  | 'preventScrolling'
  | 'nodesDraggable'
  | 'nodesConnectable'
  | 'elementsSelectable'
>

function panModeProps(mode: GraphCanvasPanMode): PanModeFlags {
  switch (mode) {
    case 'editor':
      return {
        // See `GraphCanvasPanMode` docs: Shift-selection disabled to
        // avoid the Linux first-uppercase-eaten bug; rubber-band moves
        // to left-drag, panning to the middle mouse button.
        selectionKeyCode: null,
        selectionOnDrag: true,
        panOnDrag: EDITOR_PAN_ON_DRAG,
        multiSelectionKeyCode: MULTI_SELECTION_KEYS,
        zoomOnScroll: true,
        zoomOnPinch: true
      }
    case 'classic':
      return {
        panOnDrag: true,
        panOnScroll: false,
        zoomOnScroll: true,
        zoomOnPinch: true,
        selectionKeyCode: null,
        multiSelectionKeyCode: null
      }
    case 'pointerLock':
      return {
        // Pan handled by `usePointerLockPan`; React Flow's own drag-pan
        // off so the two don't double-apply deltas. Wheel zoom only with
        // Ctrl/⌘ held so a stray wheel scrolls the page (popover-safe).
        panOnDrag: false,
        panOnScroll: false,
        zoomOnScroll: true,
        zoomActivationKeyCode: ZOOM_ACTIVATION_KEYS,
        zoomOnPinch: true,
        preventScrolling: false,
        panActivationKeyCode: null,
        deleteKeyCode: null,
        selectionKeyCode: null,
        multiSelectionKeyCode: null
      }
    case 'static':
      return {
        panOnDrag: false,
        zoomOnScroll: false,
        zoomOnPinch: false,
        // Let wheel events bubble: a static thumbnail is often mounted in
        // a scrollable strip, and React Flow's default `preventScrolling`
        // would otherwise eat the wheel while the cursor is over it.
        preventScrolling: false,
        nodesDraggable: false,
        nodesConnectable: false,
        elementsSelectable: false,
        panActivationKeyCode: null,
        deleteKeyCode: null,
        selectionKeyCode: null,
        multiSelectionKeyCode: null
      }
  }
}

function GraphCanvasInner<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  panMode = 'classic',
  showControls = true,
  background = false,
  minimap = false,
  minimapToggle,
  controlsProps,
  extraControls,
  fitView,
  fitViewOptions,
  defaultViewport,
  minZoom,
  maxZoom,
  reactFlowProps,
  children,
  'data-testid': testId
}: GraphCanvasProps<NodeType, EdgeType>): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  usePointerLockPan(wrapperRef, panMode === 'pointerLock')

  // Minimap visibility: when a toggle is offered the user controls it
  // (start hidden); otherwise it's shown whenever `minimap` is set.
  const [minimapShown, setMinimapShown] = useState(false)
  const minimapOptions = minimap === false ? null : minimap
  const showMinimap = minimapOptions !== null && (minimapToggle ? minimapShown : true)

  const controlsVisible = showControls && panMode !== 'static'

  const bg =
    background === false
      ? null
      : background === true
        ? {}
        : background

  // The 'static' preset already disables interactivity; for the other
  // presets the consumer decides via reactFlowProps. Apply the preset,
  // then defaultViewport / fitView, then the consumer's overrides.
  return (
    <div
      ref={wrapperRef}
      className="ecui-graph-canvas"
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <ReactFlow<NodeType, EdgeType>
        nodes={nodes}
        edges={edges}
        {...(nodeTypes ? { nodeTypes } : {})}
        {...(edgeTypes ? { edgeTypes } : {})}
        proOptions={PRO_OPTIONS}
        {...(minZoom !== undefined ? { minZoom } : {})}
        {...(maxZoom !== undefined ? { maxZoom } : {})}
        {...(fitViewOptions ? { fitViewOptions } : {})}
        {...panModeProps(panMode)}
        {...(defaultViewport ? { defaultViewport } : fitView ? { fitView: true } : {})}
        {...reactFlowProps}
      >
        {bg && (
          <Background
            {...(bg.id !== undefined ? { id: bg.id } : {})}
            {...(bg.gap !== undefined ? { gap: bg.gap } : {})}
            {...(bg.offset !== undefined ? { offset: bg.offset } : {})}
          />
        )}
        {controlsVisible && (
          <Controls showInteractive={false} {...controlsProps}>
            {minimapToggle && minimapOptions && (
              <ControlButton
                onClick={() => {
                  setMinimapShown((v) => !v)
                }}
                aria-label={minimapToggle.label}
                data-active={minimapShown ? 'true' : 'false'}
                {...(minimapToggle.testId ? { 'data-testid': minimapToggle.testId } : {})}
              >
                <span className="codicon codicon-map" aria-hidden="true" />
              </ControlButton>
            )}
            {extraControls}
          </Controls>
        )}
        {showMinimap && (
          <MiniMap
            className="ecui-graph-minimap"
            pannable={minimapOptions.pannable ?? true}
            zoomable={minimapOptions.zoomable ?? true}
            {...(minimapOptions.nodeColor !== undefined ? { nodeColor: minimapOptions.nodeColor } : {})}
            {...(minimapOptions.maskColor !== undefined ? { maskColor: minimapOptions.maskColor } : {})}
          />
        )}
        {children}
      </ReactFlow>
    </div>
  )
}

/**
 * Public component. Owns its own `<ReactFlowProvider>` so a consumer
 * can drop it anywhere without wiring the provider. If the consumer
 * needs `useReactFlow()` access (fit-view, getNode, focus, …) from
 * OUTSIDE this subtree, it should mount its own `<ReactFlowProvider>`
 * and pass `withoutProvider` so the contexts don't nest.
 */
export function GraphCanvas<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  withoutProvider,
  ...props
}: GraphCanvasProps<NodeType, EdgeType> & { withoutProvider?: boolean }): React.ReactElement {
  if (withoutProvider) return <GraphCanvasInner<NodeType, EdgeType> {...props} />
  return (
    <ReactFlowProvider>
      <GraphCanvasInner<NodeType, EdgeType> {...props} />
    </ReactFlowProvider>
  )
}

export default GraphCanvas
