/**
 * Embed a scenario's React Flow graph inside the global search
 * tooltip — read-only thumbnail with the same pan/zoom UX as the
 * documentation host's `ModelGraph` (custom pointer-lock pan so the
 * cursor disappears and the surrounding popover doesn't close
 * mid-drag; wheel zoom only when Ctrl/Cmd is held so the popover's
 * own scroll stays usable).
 *
 * Each node renders as a compact card — kind icon + title — small
 * enough that a sizeable scenario fits at the popover's framing.
 * Bezier edges mirror the editor's edge shape so a reader recognises
 * the dataflow at a glance.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Scenario, ScenarioNode as PersistedNode, ScenarioEdge, FolderItem } from '../../../../../shared/types/collections'
import { ScenarioNodeView, type ScenarioNodeBoxData } from '../../Scenario/nodes'
import { ScenarioBoundResolverContext } from '../../Scenario/scenarioBoundResolver'
import { useRestormStore } from '../../../store/restormStore'
import { findItemById } from '../../../utils/treeSearch'

export interface ScenarioGraphPreviewProps {
  scenario: Scenario
  /** Optional test id stamped on the wrapper for snapshot/e2e
   * assertions. */
  testId?: string
  /** When false, the preview is a static fit-to-view thumbnail: no
   * pan, no zoom, no controls (used for the run-history snapshot
   * thumbnails). Defaults to true (pan + Ctrl-wheel zoom). */
  interactive?: boolean
  /** Pan/zoom to + flash a node (e.g. a run-history log click). The
   * `token` retriggers the framing + flash even for the same node. */
  focusNode?: { nodeId: string; token: number } | null
}

// Reuse the live editor's `ScenarioNodeView` so the preview shows the
// box exactly as the user sees it in the editor — colour, status,
// every cell. Handlers are omitted, so clicks are no-ops in the
// preview (read-only by design).
const NODE_TYPES: NodeTypes = { scenarioNode: ScenarioNodeView }
const FIT_VIEW_OPTIONS = { padding: 0.15 } as const

/** Thin wrapper around React Flow that exposes the same pointer-lock
 * pan + Ctrl-wheel zoom semantics as `ModelGraph`. Kept as an inner
 * component so the wrapper can be guarded by `<ReactFlowProvider>`. */
const ScenarioGraphPreviewCanvas: React.FC<{ scenario: Scenario; testId?: string; interactive: boolean; focusNode?: { nodeId: string; token: number } | null }> = ({ scenario, testId, interactive, focusNode }) => {
  // Build the React-Flow shapes synchronously — there's no async layout
  // to wait for (positions come straight off the persisted scenario).
  // Inject the flash token into the focused node so its box pulses (the
  // editor's run-log-click flash, reused for the run-history graph).
  const nodes = useMemo(() => {
    const base = scenario.nodes.map(toReactFlowNode)
    if (!focusNode) return base
    return base.map((n) => (n.id === focusNode.nodeId ? { ...n, data: { ...n.data, flashToken: focusNode.token } } : n))
  }, [scenario, focusNode])
  const edges = useMemo(() => scenario.edges.map(toReactFlowEdge), [scenario])
  const [fitGeneration, setFitGeneration] = useState(0)
  const { fitView, getViewport, setViewport } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fittedGenerationRef = useRef(-1)
  const isPanningRef = useRef(false)
  // Re-fit once the container reaches a positive size (the popover
  // can mount with `display: none` while the parent transitions).
  const viewportWidth = useStore((s) => s.width)
  const viewportHeight = useStore((s) => s.height)
  const nodesReady = useStore((s) => {
    if (s.nodeLookup.size === 0) return false
    for (const [, n] of s.nodeLookup) {
      if (!n.measured.width || !n.measured.height) return false
    }
    return true
  })
  // Every fresh scenario triggers a fit-view round on the next layout
  // commit. Compare-and-set in render avoids the
  // `react-hooks/set-state-in-effect` rule that blocks the simpler
  // useEffect dispatch.
  const [seenScenarioId, setSeenScenarioId] = useState<string | null>(null)
  if (seenScenarioId !== scenario.id) {
    setSeenScenarioId(scenario.id)
    setFitGeneration((n) => n + 1)
  }

  useEffect(() => {
    if (!nodesReady) return
    if (nodes.length === 0) return
    if (viewportWidth <= 0 || viewportHeight <= 0) return
    if (fittedGenerationRef.current === fitGeneration) return
    fittedGenerationRef.current = fitGeneration
    // A focus request frames the target node instead (handled below); don't
    // also fit-to-whole or the two fights flicker.
    if (focusNode) return
    void fitView(FIT_VIEW_OPTIONS).then(() => { void fitView(FIT_VIEW_OPTIONS) })
  }, [nodesReady, fitGeneration, nodes.length, viewportWidth, viewportHeight, fitView, focusNode])

  // Pan/zoom to a focused node when a (new) focus request arrives. Declared
  // after the fit-to-whole effect so on a fresh mount it runs last + wins.
  const focusTokenRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!focusNode || !nodesReady) return
    if (viewportWidth <= 0 || viewportHeight <= 0) return
    if (focusTokenRef.current === focusNode.token) return
    focusTokenRef.current = focusNode.token
    void fitView({ nodes: [{ id: focusNode.nodeId }], duration: 300, maxZoom: 1.2 })
  }, [focusNode, nodesReady, viewportWidth, viewportHeight, fitView])

  // Pointer-lock pan — same recipe as `ModelGraph`. Cursor disappears
  // for the drag, so the popover never registers a `mouseleave`
  // mid-pan. Skipped entirely for a static (non-interactive) thumbnail.
  useEffect(() => {
    if (!interactive) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const pane = wrapper.querySelector<HTMLElement>('.react-flow__pane')
    if (!pane) return

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const target = e.target
      if (!(target instanceof Element)) return
      if (target.closest('.react-flow__controls')) return
      if (target.closest('button, a, input, select, textarea, [role="button"]')) return
      isPanningRef.current = true
      try { pane.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      const lockResult = pane.requestPointerLock() as Promise<void> | undefined
      if (lockResult && typeof lockResult.catch === 'function') {
        lockResult.catch(() => { /* fall back to setPointerCapture */ })
      }
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent): void => {
      if (!isPanningRef.current) return
      const vp = getViewport()
      void setViewport({ x: vp.x + e.movementX, y: vp.y + e.movementY, zoom: vp.zoom })
    }
    const endPan = (e?: PointerEvent): void => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      if (document.pointerLockElement === pane) document.exitPointerLock()
      if (e && pane.hasPointerCapture(e.pointerId)) pane.releasePointerCapture(e.pointerId)
    }
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
  }, [getViewport, setViewport, interactive])

  return (
    <div
      ref={wrapperRef}
      className="scn-preview-canvas"
      data-testid={testId ?? 'scenario-search-tooltip-graph'}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={2}
        panOnScroll={false}
        zoomOnScroll={interactive}
        zoomActivationKeyCode={['Control', 'Meta']}
        zoomOnPinch={interactive}
        preventScrolling={false}
        panOnDrag={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panActivationKeyCode={null}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
      >
        {interactive && <Controls showInteractive={false} />}
      </ReactFlow>
    </div>
  )
}

export const ScenarioGraphPreview: React.FC<ScenarioGraphPreviewProps> = ({ scenario, testId, interactive = true, focusNode = null }) => {
  // The reused live `ScenarioNodeView` resolves bound requests /
  // sub-scenarios through `ScenarioBoundResolverContext` to display
  // the correct badge + name. Without it, a request box would fall
  // back to a generic "HTTP Request" label. Wire a resolver that
  // walks the live tree so the preview shows the same labels the
  // editor does.
  const collections = useRestormStore((s) => s.collections)
  const resolveBoundItem = useMemo(
    () => (itemId: string): FolderItem | null => findItemById(collections as unknown as FolderItem[], itemId),
    [collections]
  )
  return (
    <ScenarioBoundResolverContext.Provider value={resolveBoundItem}>
      <ReactFlowProvider>
        <ScenarioGraphPreviewCanvas scenario={scenario} interactive={interactive} focusNode={focusNode} {...(testId !== undefined ? { testId } : {})} />
      </ReactFlowProvider>
    </ScenarioBoundResolverContext.Provider>
  )
}

/** Convert a persisted scenario node into the React-Flow node shape
 * the editor uses, so `ScenarioNodeView` renders the box with the
 * same chrome a user sees in the live editor. Handlers are omitted
 * (the preview is read-only) — `ScenarioNodeBoxData`'s callbacks are
 * all optional, so a missing handler just makes the corresponding
 * interaction a no-op. */
function toReactFlowNode(node: PersistedNode): Node<ScenarioNodeBoxData, 'scenarioNode'> {
  const data: ScenarioNodeBoxData = {
    kind: node.kind,
    inputs: node.inputs,
    outputs: node.outputs,
    config: node.config,
    ...(node.note ? { note: node.note } : {}),
    ...(node.color ? { color: node.color } : {}),
    ...(node.collapsed === true ? { collapsed: true } : {})
  }
  return {
    id: node.id,
    type: 'scenarioNode',
    position: { x: node.position.x, y: node.position.y },
    data
  }
}

function toReactFlowEdge(edge: ScenarioEdge): Edge {
  return {
    id: edge.id,
    source: edge.from.nodeId,
    target: edge.to.nodeId,
    // Handles are named by PORT (e.g. `corps` / `terminé` / `each`), the
    // same ids the editor wires (`sourceHandle: from.portId`). Hardcoding
    // `out` / `in` would only match single-default-port boxes — every
    // multi-port box (loops, forEach, if, …) would silently lose its edges.
    sourceHandle: edge.from.portId,
    targetHandle: edge.to.portId,
    type: 'default'
  }
}
