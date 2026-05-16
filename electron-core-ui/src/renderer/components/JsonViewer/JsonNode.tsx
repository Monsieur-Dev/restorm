import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { JsonNodeData, JsonEntry } from './jsonGraphLayout'
import { JSON_NODE_DIMENSIONS, ToggleCollapsedContext } from './jsonGraphLayout'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'

/**
 * Single node in the JSON graph. Renders one composite (object or
 * array) as a vertical stack of `key: value` rows. No header — just
 * the rows — so the visual weight is on the data itself.
 *
 * - Leaf rows show the primitive value inline (`"foo": 42`,
 *   `"bar": "hello"`, `"baz": null`). Values are colour-coded
 *   distinct from keys so the eye picks the split out quickly. If
 *   the rendered value is too long for the row, the row mounts an
 *   ECUI `<Tooltip>` that surfaces the full value on hover.
 * - Composite rows show a placeholder (`{n}` for object, `[n]` for
 *   array) and own a source handle on the right edge — the parent →
 *   child edge anchors to that row so the connection visually marks
 *   the property carrying the reference.
 *
 * The incoming target handle on the left edge is rendered only when
 * the node is NOT the root — the root has nothing pointing at it, so
 * the unused dot is visual noise.
 */
export const JsonNode: React.FC<NodeProps> = (props) => {
	const data = props.data as JsonNodeData
	const ROW_H = JSON_NODE_DIMENSIONS.rowHeight
	const WIDTH = JSON_NODE_DIMENSIONS.width
	// React Flow gives us this node's world position via NodeProps —
	// we forward it to the row so the collapse-button click handler
	// can pass the position up. The viewer needs the *position at
	// click time* (before the layout pass re-shuffles things) to pin
	// this node at the same screen spot afterwards.
	const ownerWorldX = props.positionAbsoluteX
	const ownerWorldY = props.positionAbsoluteY
	return (
		<div
			// React Flow's `nopan` class alone isn't enough here because
			// `nodesDraggable={false}` makes the wrapper drop its
			// auto-added `nopan` class — d3-zoom installs `mousedown` on
			// the pane and still picks up our node's events. We also
			// stop the `mousedown` event from bubbling so the click on
			// the collapse button (and any future interactive child)
			// reaches its handler instead of starting a pan-drag. The
			// empty canvas around nodes still pans.
			className="nopan"
			onMouseDown={(e) => { e.stopPropagation() }}
			style={{
				width: WIDTH,
				background: 'var(--editorWidget-background)',
				border: '1px solid var(--panel-border)',
				borderRadius: 4,
				fontSize: 12,
				fontFamily: 'var(--monospace-font-family, monospace)',
				color: 'var(--foreground)',
				cursor: 'default',
				overflow: 'hidden'
			}}
		>
			{!data.isRoot && (
				<Handle
					type="target"
					position={Position.Left}
					isConnectable={false}
					style={{
						background: 'var(--focusBorder)',
						border: 'none',
						width: 6,
						height: 6,
						cursor: 'default',
						pointerEvents: 'none'
					}}
				/>
			)}
			<div style={{ padding: '4px 0' }}>
				{data.entries.map((entry, i) => (
					<JsonNodeRow
						key={`${entry.key}-${i}`}
						entry={entry}
						isFirst={i === 0}
						rowHeight={ROW_H}
						collapsedKeys={data.collapsedKeys}
						ownerWorldX={ownerWorldX}
						ownerWorldY={ownerWorldY}
					/>
				))}
			</div>
		</div>
	)
}

JsonNode.displayName = 'JsonNode'

const JsonNodeRow: React.FC<{
	entry: JsonEntry
	isFirst: boolean
	rowHeight: number
	collapsedKeys: ReadonlySet<string>
	ownerWorldX: number
	ownerWorldY: number
}> = ({ entry, isFirst, rowHeight, collapsedKeys, ownerWorldX, ownerWorldY }) => {
	const onToggleCollapsed = useContext(ToggleCollapsedContext)
	const isCollapsed = entry.collapseKey !== undefined && collapsedKeys.has(entry.collapseKey)
	const valueRef = useRef<HTMLSpanElement | null>(null)
	const [hovered, setHovered] = useState(false)
	const [truncated, setTruncated] = useState(false)
	// Two complementary measurements:
	// 1. Synchronous layout-effect probe on value / mount — catches the
	//    common case where the layout settles before paint.
	// 2. `ResizeObserver` covers the case where React Flow lays the
	//    node out AFTER our first layout pass (the canvas viewport
	//    can resize the visible node when the user zooms or when the
	//    graph re-fits) — without the observer, a span that's narrow
	//    at first paint and wide later would stay flagged
	//    "not truncated" forever.
	const measure = (): void => {
		const el = valueRef.current
		if (!el) return
		setTruncated(el.scrollWidth > el.clientWidth + 0.5)
	}
	useLayoutEffect(measure, [entry.value])
	useEffect(() => {
		const el = valueRef.current
		if (!el || typeof ResizeObserver === 'undefined') return
		const ro = new ResizeObserver(() => { measure() })
		ro.observe(el)
		return () => { ro.disconnect() }
	}, [])
	const valueColor = entry.kind === 'composite'
		? 'var(--textLink-foreground)'
		: 'var(--symbolIcon-stringForeground, var(--debugTokenExpression-string, #ce9178))'
	const valueSpan = (
		<span
			ref={valueRef}
			style={{
				color: valueColor,
				whiteSpace: 'nowrap',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				display: 'block',
				flex: 1,
				// Required for the flex item to actually shrink below its
				// content's intrinsic min-width — without it, the span
				// stays at full text width and the row clips at the
				// node's outer border instead of the span's edge, so
				// `scrollWidth > clientWidth` never fires and the
				// tooltip never mounts. See CSS spec §7.1 "Implied
				// Minimum Size of Flex Items".
				minWidth: 0
			}}
		>
			{entry.value}
		</span>
	)
	return (
		<div
			style={{
				position: 'relative',
				height: rowHeight,
				display: 'flex',
				alignItems: 'center',
				padding: '0 8px',
				gap: 6,
				borderTop: isFirst ? 'none' : '1px solid var(--panel-border)'
			}}
			onMouseEnter={() => { setHovered(true) }}
			onMouseLeave={() => { setHovered(false) }}
		>
			<span
				style={{
					color: 'var(--symbolIcon-keyForeground, var(--textLink-foreground))',
					whiteSpace: 'nowrap'
				}}
			>
				{entry.key}
			</span>
			<span style={{ color: 'var(--descriptionForeground)' }}>:</span>
			{valueSpan}
			{truncated && (
				<Tooltip
					targetRef={valueRef}
					show={hovered}
					content={<span style={{ wordBreak: 'break-word' }}>{entry.value}</span>}
				/>
			)}
			{entry.kind === 'composite' && entry.collapseKey !== undefined && (() => {
				const key = entry.collapseKey
				return (
					<Button
						small
						secondary
						icon={isCollapsed ? 'worktree' : 'dash'}
						onClick={() => {
							onToggleCollapsed(key, { x: ownerWorldX, y: ownerWorldY })
						}}
						options={{
							ariaLabel: isCollapsed ? 'Expand' : 'Collapse',
							title: isCollapsed ? 'Expand' : 'Collapse'
						}}
					/>
				)
			})()}
			{entry.kind === 'composite' && !isCollapsed && (
				<Handle
					type="source"
					position={Position.Right}
					id={`out:${entry.key}`}
					isConnectable={false}
					style={{
						background: 'var(--textLink-foreground)',
						border: 'none',
						width: 6,
						height: 6,
						top: '50%',
						cursor: 'default',
						pointerEvents: 'none'
					}}
				/>
			)}
		</div>
	)
}
