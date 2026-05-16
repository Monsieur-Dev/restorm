import { createContext } from 'react'
import type { Edge, Node } from '@xyflow/react'

/** Signature of the click handler installed by `JsonViewer` and
 * consumed by `JsonNode` via React context. The handler receives
 * the collapse key for the clicked row and the current world
 * position of the owning node (forwarded by `JsonNode` from
 * React Flow's `NodeProps`). */
export type ToggleCollapsedFn = (collapseKey: string, ownerWorldPos: { x: number; y: number }) => void

/** Click handler for collapse / expand. `JsonNode` reads this from
 * the surrounding context rather than from node data — keeping the
 * function out of the memoised graph elements satisfies the
 * `react-hooks/refs` lint (which forbids passing a function that
 * touches a ref into anything that runs during render). */
export const ToggleCollapsedContext = createContext<ToggleCollapsedFn>(() => undefined)

/**
 * Per-property entry rendered inside one `JsonNode`. The viewer puts
 * one of these on a single visual row.
 *
 * - `kind: 'leaf'`  → the value is a primitive (string / number /
 *   boolean / null). The row shows `key: <pretty value>` inline; no
 *   child node, no edge.
 * - `kind: 'composite'` → the value is a nested object or array. The
 *   row shows a placeholder (`{n}` / `[n]`) and the parent node has
 *   an outgoing edge to a separately-rendered child node carrying
 *   that composite's own entries.
 *
 * `targetNodeId` is set when `kind === 'composite'` to wire up the
 * edge target without re-walking the tree.
 */
export interface JsonEntry {
	key: string
	kind: 'leaf' | 'composite'
	value: string
	/** Target node id(s) wired off this row. Usually a single id (one
	 * nested object / non-uniform array → one intermediate node).
	 * Multiple ids appear when the source value is an "array of
	 * objects" — we collapse the intermediate index-only node away,
	 * so the row fans out directly to each object node. */
	targetNodeIds?: string[]
	/** Stable key passed to `onToggleCollapsed` when the user clicks
	 * the row's collapse / expand button. Only set on composite
	 * rows. */
	collapseKey?: string
}

export interface JsonNodeData extends Record<string, unknown> {
	entries: JsonEntry[]
	/** True if this node is the graph root — used by the renderer to
	 * suppress the incoming target handle (the root has nothing
	 * pointing at it, so the unused dot is visual noise). */
	isRoot: boolean
	/** Per-row collapse keys currently in the user's "collapsed" set.
	 * A composite row whose `collapseKey` is here renders a + button
	 * (expand) instead of − (collapse). Hands the same Set down so
	 * every node sees the same truth without a context dance. */
	collapsedKeys: ReadonlySet<string>
}

/** Stable key identifying one composite row across re-renders. The
 * source node id + the entry's key uniquely identify it because each
 * composite belongs to exactly one parent row. */
export function makeCollapseKey(nodeId: string, entryKey: string): string {
	return `${nodeId}::${entryKey}`
}

export interface JsonGraphElements {
	nodes: Node[]
	edges: Edge[]
}

const NODE_WIDTH = 280
const ROW_HEIGHT = 22
const NODE_VERTICAL_GAP = 40
const COLUMN_HORIZONTAL_GAP = 80

function estimateNodeHeight(entryCount: number): number {
	return Math.max(1, entryCount) * ROW_HEIGHT + 8
}

function formatPrimitive(value: unknown): string {
	if (value === null) return 'null'
	if (typeof value === 'string') return JSON.stringify(value)
	if (typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'true' : 'false'
	if (typeof value === 'undefined') return 'undefined'
	return JSON.stringify(value)
}

function isComposite(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === 'object'
}

/**
 * Walk a JSON value and produce `{ nodes, edges }` suitable for
 * `@xyflow/react`. Layout is a simple per-depth column packing —
 * each node sits in the column matching its depth in the tree, and
 * vertical positions stack so subtrees don't visually collide. The
 * graph is a tree (one parent per node, no cycles), so the algorithm
 * is one BFS pass; no ELK / d3-hierarchy needed for this shape.
 *
 * Subtree positioning: each composite reserves a vertical slot equal
 * to its own subtree height. That way a deep-but-narrow branch
 * doesn't shove a parallel branch off-screen.
 *
 * `collapsedKeys` lists the collapse-keys (see `makeCollapseKey`)
 * the user has asked to hide. A composite row whose collapse-key
 * appears in the set still renders its row in the parent node — so
 * the user can expand it again — but its child node(s) and their
 * entire subtree are pruned from the output.
 */
export function buildJsonGraphElements(
	root: unknown,
	collapsedKeys: ReadonlySet<string> = new Set()
): JsonGraphElements {
	const nodes: Node[] = []
	const edges: Edge[] = []

	interface Subtree {
		nodeId: string
		entries: JsonEntry[]
		children: Subtree[]
		height: number
	}

	// Node IDs are JSON paths (`root`, `root.cooldown`, `root.list.0`,
	// …). Stability matters: when the user collapses a subtree we
	// need to find the SAME node again in the next layout pass —
	// otherwise pan-to-focus and the collapsedKeys set itself can't
	// match across renders. The path is a deterministic function of
	// the JSON value's location, so two builds with the same JSON
	// produce the same IDs regardless of which subtrees were pruned.
	function build(value: unknown, path: string): Subtree {
		const id = path
		const isArr = Array.isArray(value)
		const raw = isArr
			? (value as unknown[]).map((v, i) => [String(i), v] as const)
			: Object.entries(value as Record<string, unknown>)
		const entries: JsonEntry[] = []
		const children: Subtree[] = []
		for (const [key, v] of raw) {
			if (isComposite(v)) {
				const childIsArr = Array.isArray(v)
				const childItems = childIsArr ? v : Object.values(v)
				if (childItems.length === 0) {
					// Empty array / empty object — render the placeholder
					// inline, no child node, no edge. A separate empty
					// rectangle dangling off this row would be visual noise.
					entries.push({
						key,
						kind: 'leaf',
						value: childIsArr ? '[]' : '{}'
					})
					continue
				}
				const collapseKey = makeCollapseKey(id, key)
				const isCollapsed = collapsedKeys.has(collapseKey)
				const childPath = `${id}.${key}`
				// Array-of-composites shortcut: when every element of an
				// array is itself a composite (object / array), the
				// intermediate "index → object" node serves no purpose
				// (it would just list `0: {n}`, `1: {n}`, … each
				// pointing at the actual data). Skip it and wire the
				// parent row to fan out directly into each child.
				if (childIsArr && childItems.every((item) => isComposite(item))) {
					const childSubtrees = isCollapsed
						? []
						: childItems.map((item, i) => build(item, `${childPath}.${i}`))
					const entry: JsonEntry = {
						key,
						kind: 'composite',
						value: `[${childItems.length}]`,
						collapseKey
					}
					if (childSubtrees.length > 0) entry.targetNodeIds = childSubtrees.map((s) => s.nodeId)
					entries.push(entry)
					children.push(...childSubtrees)
					continue
				}
				const childSubtree = isCollapsed ? null : build(v, childPath)
				const entry: JsonEntry = {
					key,
					kind: 'composite',
					value: childIsArr ? `[${childItems.length}]` : `{${childItems.length}}`,
					collapseKey
				}
				if (childSubtree !== null) entry.targetNodeIds = [childSubtree.nodeId]
				entries.push(entry)
				if (childSubtree !== null) children.push(childSubtree)
			} else {
				entries.push({ key, kind: 'leaf', value: formatPrimitive(v) })
			}
		}
		const ownHeight = estimateNodeHeight(entries.length)
		const subtreeHeight = children.length === 0
			? ownHeight
			: Math.max(
				ownHeight,
				children.reduce((sum, c, i) => sum + c.height + (i > 0 ? NODE_VERTICAL_GAP : 0), 0)
			)
		return { nodeId: id, entries, children, height: subtreeHeight }
	}

	function place(tree: Subtree, depth: number, top: number, parentId: string | null, parentKey: string | null): void {
		const x = depth * (NODE_WIDTH + COLUMN_HORIZONTAL_GAP)
		const ownHeight = estimateNodeHeight(tree.entries.length)
		// Centre the parent vertically against its subtree so the edges
		// look balanced rather than always anchoring at the top.
		const y = top + Math.max(0, (tree.height - ownHeight) / 2)
		nodes.push({
			id: tree.nodeId,
			type: 'jsonNode',
			data: {
				entries: tree.entries,
				isRoot: parentId === null,
				collapsedKeys
			},
			position: { x, y },
			width: NODE_WIDTH,
			height: ownHeight,
			// Force pointer-events on the React Flow node wrapper. With
			// `nodesDraggable={false}`, `elementsSelectable={false}` and no
			// node-level event handlers, React Flow infers the node has no
			// interactive purpose and sets `pointer-events: none` — which
			// also drops clicks on our collapse button and `mouseenter` on
			// our truncated-value rows (no tooltip). `node.style` is
			// merged AFTER React Flow's inline style, so it wins.
			style: { pointerEvents: 'all' }
		})
		if (parentId !== null) {
			const edge: Edge = {
				id: `${parentId}->${tree.nodeId}`,
				source: parentId,
				target: tree.nodeId,
				type: 'default'
			}
			if (parentKey !== null) edge.sourceHandle = `out:${parentKey}`
			edges.push(edge)
		}
		let cursor = top
		for (const child of tree.children) {
			const entry = tree.entries.find((e) => e.targetNodeIds?.includes(child.nodeId))
			place(child, depth + 1, cursor, tree.nodeId, entry?.key ?? null)
			cursor += child.height + NODE_VERTICAL_GAP
		}
	}

	if (isComposite(root)) {
		const tree = build(root, 'root')
		place(tree, 0, 0, null, null)
	} else {
		// Primitive root — render a single node with one entry.
		nodes.push({
			id: 'root',
			type: 'jsonNode',
			data: {
				entries: [{ key: '', kind: 'leaf', value: formatPrimitive(root) }],
				isRoot: true,
				collapsedKeys
			},
			position: { x: 0, y: 0 },
			width: NODE_WIDTH,
			height: estimateNodeHeight(1),
			style: { pointerEvents: 'all' }
		})
	}

	return { nodes, edges }
}

export const JSON_NODE_DIMENSIONS = {
	width: NODE_WIDTH,
	rowHeight: ROW_HEIGHT
}
