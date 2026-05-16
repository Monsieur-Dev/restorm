/**
 * JsonViewer — node-based JSON graph viewer.
 *
 * Renders a JSON string as a tree of `<JsonNode>`s wired together by
 * React Flow. Re-uses the documentation viewer's underlying graph
 * stack (`@xyflow/react` + `elkjs`-style layered layout, here
 * simplified to a per-depth column pack since the JSON is always a
 * tree).
 *
 * This component replaces the previous `jsoncrack-react` integration,
 * which had two blockers we couldn't work around in-tree:
 *   1. Global zustand store — multiple viewer instances on screen
 *      shared state, so switching between request tabs caused tab B
 *      to display tab A's data.
 *   2. Unobservable layout pipeline — `centerView()` worked
 *      intermittently because the lib gave no reliable "ready"
 *      signal.
 *
 * Features:
 * - Zoom in / zoom out / fit-view buttons
 * - Mouse wheel zoom (React Flow's native handling)
 * - Auto-fit on mount + every JSON content change (deterministic now
 *   that we own the layout)
 * - Dark / light theme via CSS variables
 *
 * @example
 * ```tsx
 * import { JsonViewer } from 'electron-core-ui/renderer'
 *
 * <JsonViewer json='{"key": "value"}' />
 * ```
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	Controls,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Edge,
	type EdgeTypes,
	type Node,
	type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { JsonNode } from './JsonNode'
import { buildJsonGraphElements, ToggleCollapsedContext, type ToggleCollapsedFn } from './jsonGraphLayout'
import './jsonViewer.css'

export interface JsonViewerProps {
	/** JSON string to visualize as a graph. Pre-stringified by the
	 * caller (the host parses + pretty-prints once, so the same string
	 * is reused across re-renders without re-doing the work). */
	json: string
	/** Dark theme flag. Kept for API parity with the previous
	 * implementation, currently a no-op — node theming comes from CSS
	 * variables that already track the workbench theme. */
	darkTheme?: boolean
	/** Test ID prefix for E2E selectors. */
	'data-testid'?: string
}

const NODE_TYPES: NodeTypes = { jsonNode: JsonNode }
const EDGE_TYPES: EdgeTypes = {}
/** Animation duration used for both the React Flow viewport's
 * `fitView({ duration })` and the CSS `transition` on node positions
 * (see the `.json-viewer-canvas .react-flow__node` rule below). Both
 * use the same value so the camera arrives at the new framing on the
 * same beat as the nodes finish settling. */
const ANIMATION_MS = 350
const FIT_VIEW_OPTIONS = { padding: 0.1, duration: ANIMATION_MS } as const
const INITIAL_FIT_VIEW_OPTIONS = { padding: 0.1 } as const

export const JsonViewer: React.FC<JsonViewerProps> = (props) => {
	return (
		<div
			style={{
				boxSizing: 'border-box',
				padding: '8px 0 0 8px',
				width: '100%',
				height: '100%',
				overflow: 'hidden'
			}}
		>
			<div
				style={{
					flex: 1,
					minHeight: 0,
					border: '1px solid var(--panel-border)',
					borderRadius: 3,
					boxSizing: 'border-box',
					position: 'relative',
					overflow: 'hidden',
					height: '100%'
				}}
			>
				<ReactFlowProvider>
					<JsonViewerCanvas {...props} />
				</ReactFlowProvider>
			</div>
		</div>
	)
}

const JsonViewerCanvas: React.FC<JsonViewerProps> = ({ json, 'data-testid': testId }) => {
	const { fitView, getNode, getViewport, setViewport } = useReactFlow()
	const containerRef = useRef<HTMLDivElement | null>(null)
	const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set<string>())
	// When the user is off-fit and clicks a collapse / expand button,
	// the next layout pass typically shoves that node to a new world
	// position. Without intervention the user loses their reference
	// point — the row they just clicked may end up off-screen. We
	// snapshot the clicked node's old world position here, then in
	// the post-layout effect we shift the viewport so the same node
	// lands at the same SCREEN position (zoom unchanged).
	const pendingFocusRef = useRef<{ nodeId: string; oldPos: { x: number; y: number } } | null>(null)
	const toggleCollapsed = useCallback<ToggleCollapsedFn>((collapseKey, ownerWorldPos) => {
		// `collapseKey` is `${parentNodeId}::${entryKey}` — the parent
		// node owning the clicked row is the one we want to keep
		// anchored on screen. Its current world position comes in
		// from the clicked `JsonNode` itself (via React Flow's
		// `NodeProps.positionAbsoluteX/Y`) so this callback doesn't
		// need to close over `getNode` from `useReactFlow()`. Keeps
		// the function stable + dependency-light, which keeps the
		// `react-hooks/refs` lint happy when we pass it down into the
		// memoised graph elements.
		const sepIdx = collapseKey.indexOf('::')
		if (sepIdx > 0) {
			pendingFocusRef.current = {
				nodeId: collapseKey.slice(0, sepIdx),
				oldPos: ownerWorldPos
			}
		}
		setCollapsedKeys((prev) => {
			const next = new Set(prev)
			if (next.has(collapseKey)) next.delete(collapseKey)
			else next.add(collapseKey)
			return next
		})
	}, [])
	// `buildJsonGraphElements` is pure — same `json` string + same
	// collapsed-keys in, same nodes/edges out. Memoising lets React
	// Flow skip its diffing pass when the parent re-renders without
	// either signal changing.
	const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
		try {
			const parsed: unknown = JSON.parse(json || '{}')
			return buildJsonGraphElements(parsed, collapsedKeys)
		} catch {
			// Caller is responsible for handing us valid JSON; if they
			// don't, render an empty graph rather than throw — the rest
			// of the response panel still works.
			return { nodes: [], edges: [] }
		}
	}, [json, collapsedKeys])

	// Auto-fit on every change of the rendered graph. We own the React
	// Flow viewport now, so this is deterministic — no library
	// timing-guesswork. Still wrapped in `requestAnimationFrame` so
	// the call lands after React Flow's first commit, and given a
	// small safety re-fit on the next frame for the case where the
	// container resized between commit and paint (lazy-mounted tab).
	//
	// First fit is instant (no zoom-in jank when the panel mounts);
	// subsequent fits — typically triggered by collapse / expand —
	// animate so the camera tracks the visibly-moving nodes instead
	// of teleporting.
	//
	// Auto-fit is suppressed once the user has panned or zoomed away
	// from the auto-framed viewport: their manual framing is treated
	// as intentional and we don't yank the camera back on every
	// collapse / expand. Clicking the Center View button re-arms the
	// auto-fit. We detect "user moved" via `onMove`'s first argument
	// being a real DOM event (programmatic moves like `fitView` pass
	// `null`).
	const firstFitRef = useRef(true)
	const userMovedRef = useRef(false)
	const handleMove = useCallback((event: MouseEvent | TouchEvent | null): void => {
		if (event !== null) userMovedRef.current = true
	}, [])
	useEffect(() => {
		const id1 = requestAnimationFrame(() => {
			if (firstFitRef.current) {
				// First fit — instant frame, no animation, ignores any
				// pendingFocus (there can't be one yet anyway).
				void fitView(INITIAL_FIT_VIEW_OPTIONS)
				const id2 = requestAnimationFrame(() => { void fitView(INITIAL_FIT_VIEW_OPTIONS) })
				rafIds.current.push(id2)
				firstFitRef.current = false
				pendingFocusRef.current = null
				return
			}
			if (!userMovedRef.current) {
				// Auto-fit branch — user hasn't framed manually, so we
				// keep the camera following the data.
				void fitView(FIT_VIEW_OPTIONS)
				const id2 = requestAnimationFrame(() => { void fitView(FIT_VIEW_OPTIONS) })
				rafIds.current.push(id2)
				pendingFocusRef.current = null
				return
			}
			// User-framed branch — preserve their zoom + leave the
			// rest of the graph alone, but pan so the clicked node
			// stays exactly where it was on screen. Without this the
			// row the user clicked frequently scrolls off-screen
			// because its world position shifted under the layout
			// re-pack.
			const pending = pendingFocusRef.current
			pendingFocusRef.current = null
			if (!pending) return
			const newNode = getNode(pending.nodeId)
			if (!newNode) return
			const dx = newNode.position.x - pending.oldPos.x
			const dy = newNode.position.y - pending.oldPos.y
			if (dx === 0 && dy === 0) return
			const v = getViewport()
			// Screen pos = world pos * zoom + viewport offset. To pin
			// `newWorldPos` to the same screen pos `oldWorldPos` used
			// to occupy, the offset must move by `-delta * zoom`.
			void setViewport(
				{ x: v.x - dx * v.zoom, y: v.y - dy * v.zoom, zoom: v.zoom },
				{ duration: ANIMATION_MS }
			)
		})
		rafIds.current.push(id1)
		return () => {
			for (const id of rafIds.current) cancelAnimationFrame(id)
			rafIds.current = []
		}
	}, [nodes, edges, fitView, getNode, getViewport, setViewport])
	const rafIds = useRef<number[]>([])
	const handleCenterView = useCallback((): void => {
		userMovedRef.current = false
		void fitView(FIT_VIEW_OPTIONS)
	}, [fitView])

	return (
		<div ref={containerRef} className="json-viewer-canvas" style={{ width: '100%', height: '100%', position: 'relative' }}>
			<ToggleCollapsedContext.Provider value={toggleCollapsed}>
				<ReactFlow
					nodes={nodes}
					edges={edges}
					nodeTypes={NODE_TYPES}
					edgeTypes={EDGE_TYPES}
					fitView
					fitViewOptions={INITIAL_FIT_VIEW_OPTIONS}
					minZoom={0.05}
					maxZoom={3}
					nodesDraggable={false}
					nodesConnectable={false}
					elementsSelectable={false}
					panOnDrag
					zoomOnScroll
					onMove={handleMove}
					proOptions={{ hideAttribution: true }}
					{...(testId ? { 'data-testid': testId } : {})}
				>
					{/*
					 * React Flow's built-in Controls: visual consistency
					 * with the doc viewer (`ModelGraph`) which uses the
					 * same component. `showInteractive={false}` hides the
					 * lock toggle — relevant for editable graphs, noise
					 * here. `onFitView` overrides the default fit so we
					 * can also reset `userMovedRef`: clicking Center View
					 * is the user's explicit "re-arm auto-fit" signal,
					 * matching how the auto-fit branch in the post-layout
					 * effect re-engages.
					 */}
					<Controls
						showInteractive={false}
						fitViewOptions={FIT_VIEW_OPTIONS}
						onFitView={handleCenterView}
					/>
				</ReactFlow>
			</ToggleCollapsedContext.Provider>
		</div>
	)
}

export default JsonViewer
