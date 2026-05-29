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
  type NodeProps,
  type NodeTypes
} from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Scenario, ScenarioNode as PersistedNode, ScenarioEdge, ScenarioNodeKind } from '../../../../../shared/types/collections'
import { scenarioNodeMeta } from '../../Scenario/scenarioNodeCatalogue'
import { Badge } from '../../common/Badge'

export interface ScenarioGraphPreviewProps {
  scenario: Scenario
  /** Optional test id stamped on the wrapper for snapshot/e2e
   * assertions. */
  testId?: string
}

const NODE_TYPES: NodeTypes = { scenarioPreview: ScenarioPreviewNode }
const FIT_VIEW_OPTIONS = { padding: 0.15 } as const

/**
 * Compact read-only node used by the preview — kind icon (or
 * protocol badge for httpRequest / runScenario) + short title. Two
 * stub handles keep React Flow's edge endpoints anchored without
 * showing the dynamic-port list a live editor box renders.
 */
function ScenarioPreviewNode({ data }: NodeProps): React.ReactElement {
  const d = data as { kind: ScenarioNodeKind; title: string; badge?: 'request' | 'scenario' | undefined; method?: string | undefined }
  const meta = scenarioNodeMeta(d.kind)
  return (
    <div className="scn-preview-node">
      <Handle id="in" type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      {d.badge === 'scenario'
        ? <Badge type="SCENARIO" />
        : d.badge === 'request' && d.method
          ? <Badge type={d.method.toUpperCase() as Parameters<typeof Badge>[0]['type']} />
          : <i className={`codicon codicon-${meta.icon}`} aria-hidden="true" />}
      <span className="scn-preview-node-title">{d.title}</span>
      <Handle id="out" type="source" position={Position.Right} style={{ visibility: 'hidden' }} />
    </div>
  )
}

/** Thin wrapper around React Flow that exposes the same pointer-lock
 * pan + Ctrl-wheel zoom semantics as `ModelGraph`. Kept as an inner
 * component so the wrapper can be guarded by `<ReactFlowProvider>`. */
const ScenarioGraphPreviewCanvas: React.FC<{ scenario: Scenario; testId?: string }> = ({ scenario, testId }) => {
  // Build the React-Flow shapes synchronously — there's no async layout
  // to wait for (positions come straight off the persisted scenario).
  const nodes = useMemo(() => scenario.nodes.map(toReactFlowNode), [scenario])
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
    void fitView(FIT_VIEW_OPTIONS).then(() => { void fitView(FIT_VIEW_OPTIONS) })
  }, [nodesReady, fitGeneration, nodes.length, viewportWidth, viewportHeight, fitView])

  // Pointer-lock pan — same recipe as `ModelGraph`. Cursor disappears
  // for the drag, so the popover never registers a `mouseleave`
  // mid-pan.
  useEffect(() => {
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
  }, [getViewport, setViewport])

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
        zoomOnScroll
        zoomActivationKeyCode={['Control', 'Meta']}
        zoomOnPinch
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
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export const ScenarioGraphPreview: React.FC<ScenarioGraphPreviewProps> = ({ scenario, testId }) => (
  <ReactFlowProvider>
    <ScenarioGraphPreviewCanvas scenario={scenario} {...(testId !== undefined ? { testId } : {})} />
  </ReactFlowProvider>
)

/** Convert a persisted scenario node into React Flow's node shape.
 * The compact data carries only what the preview node renders —
 * title + kind + (optional) request method / scenario badge — so the
 * thumbnail stays light even on a large graph. */
function toReactFlowNode(node: PersistedNode): Node {
  const cfg = (node as { config?: Record<string, unknown> }).config ?? {}
  let title = scenarioNodeMeta(node.kind).defaultLabel
  let badge: 'request' | 'scenario' | undefined
  let method: string | undefined
  if (node.kind === 'httpRequest') {
    badge = 'request'
    method = typeof cfg['method'] === 'string' ? cfg['method'] : 'GET'
    if (typeof cfg['title'] === 'string') title = cfg['title']
  } else if (node.kind === 'runScenario') {
    badge = 'scenario'
    if (typeof cfg['title'] === 'string') title = cfg['title']
  }
  return {
    id: node.id,
    type: 'scenarioPreview',
    position: { x: node.position.x, y: node.position.y },
    data: { kind: node.kind, title, ...(badge !== undefined ? { badge } : {}), ...(method !== undefined ? { method } : {}) }
  }
}

function toReactFlowEdge(edge: ScenarioEdge): Edge {
  return {
    id: edge.id,
    source: edge.from.nodeId,
    target: edge.to.nodeId,
    sourceHandle: 'out',
    targetHandle: 'in',
    type: 'default'
  }
}
