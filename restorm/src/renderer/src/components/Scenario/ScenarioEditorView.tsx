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
import { Button, ContextMenu, Tooltip, ColorPicker, Modal, MarkdownEditor } from 'electron-core-ui/renderer'
import type { Scenario, ScenarioNode, ScenarioEdge, ScenarioNodeKind } from '../../../../shared/types/collections'
import { isRequest, isScenario } from '../../../../shared/types/collections'
import { ScenarioBoundResolverContext, ScenarioRequestEnvContext, type ResolveBoundItem, type ResolveRequestEnv } from './scenarioBoundResolver'
import { SCENARIO_NODE_CATALOGUE } from './scenarioNodeCatalogue'
import { scenarioEdgeToFlowEdge, flowEdgeToScenarioEdge } from './scenarioGraphMapping'
import { ScenarioNodeView, type ScenarioNodeBoxData } from './nodes'
import { defaultPortsForKind } from './scenarioNodePorts'

export interface ScenarioEditorViewProps {
  /** The scenario being edited. */
  scenario: Scenario
  /** Persist node/edge edits back to the tree (debounced by the host). */
  onScenarioChange?: (scenarioId: string, patch: { nodes?: ScenarioNode[]; edges?: Scenario['edges']; notes?: string }) => void
  /**
   * Resolve a tree item by id → live object. Drives both sidebar-drop
   * creation (Request → `request`, Scenario → `runScenario`, else ignored)
   * and the live badge/title sync of bound request / sub-scenario nodes.
   */
  resolveBoundItem?: ResolveBoundItem
  /** Resolve a request's environments + default selection (env-selector section). */
  resolveRequestEnv?: ResolveRequestEnv
}

type NodeData = ScenarioNodeBoxData

const nodeTypes = { scenarioNode: ScenarioNodeView }

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

interface NodeHandlers {
  onToggleCollapse: (id: string) => void
  onHeaderContextMenu: (id: string, x: number, y: number) => void
}

function toFlowNode(n: ScenarioNode, handlers: NodeHandlers): Node<NodeData> {
  return {
    id: n.id,
    type: 'scenarioNode',
    position: n.position,
    data: {
      kind: n.kind,
      inputs: n.inputs,
      outputs: n.outputs,
      config: n.config,
      onToggleCollapse: handlers.onToggleCollapse,
      onHeaderContextMenu: handlers.onHeaderContextMenu,
      ...(n.note !== undefined ? { note: n.note } : {}),
      ...(n.color !== undefined ? { color: n.color } : {}),
      ...(n.collapsed !== undefined ? { collapsed: n.collapsed } : {})
    }
  }
}

function toFlowEdge(e: ScenarioEdge): Edge {
  return scenarioEdgeToFlowEdge(e) as Edge
}

/**
 * Pick the colour-picker tooltip placement around a node header, by the
 * user's priority: above → right → left → below (below = under the
 * header, over the body). Falls through to below when nothing fits.
 */
function chooseColorTooltipPlacement(rect: DOMRect): { placement: 'above' | 'below'; side: 'auto' | 'left' | 'right' } {
  const W = 232
  const H = 300
  const gap = 14
  if (rect.top >= H + gap) return { placement: 'above', side: 'auto' }
  if (window.innerWidth - rect.right >= W + gap) return { placement: 'below', side: 'right' }
  if (rect.left >= W + gap) return { placement: 'below', side: 'left' }
  return { placement: 'below', side: 'auto' }
}

const ScenarioEditorCanvas: React.FC<ScenarioEditorViewProps> = ({ scenario, onScenarioChange, resolveBoundItem, resolveRequestEnv }) => {
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
  // The scenario currently seeded into React Flow. Re-seeding only happens
  // when this changes (opening a different scenario / tab switch) — NOT on
  // our own persist writes, which replace `scenario.nodes` and would
  // otherwise rebuild every node and wipe selection / drag state.
  const seededId = useRef<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const [palette, setPalette] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [colorPickerNodeId, setColorPickerNodeId] = useState<string | null>(null)
  // The header element the colour-picker tooltip anchors its beak to.
  const colorTargetRef = useRef<HTMLElement | null>(null)
  // Tooltip placement computed when the picker opens (so render reads state,
  // not the anchor ref).
  const [colorPlacement, setColorPlacement] = useState<{ placement: 'above' | 'below'; side: 'auto' | 'left' | 'right' }>({ placement: 'above', side: 'auto' })
  const [noteEditorNodeId, setNoteEditorNodeId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

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

  // Right-click on a header: select that node (deselect the rest) AND open
  // the node context menu at the cursor.
  const onHeaderContextMenu = useCallback((nodeId: string, x: number, y: number) => {
    setNodes((curr) => curr.map((fn) => (fn.selected === (fn.id === nodeId) ? fn : { ...fn, selected: fn.id === nodeId })))
    setNodeMenu({ nodeId, x, y })
  }, [setNodes])

  const handlers = useRef<NodeHandlers>({ onToggleCollapse, onHeaderContextMenu })
  useEffect(() => { handlers.current = { onToggleCollapse, onHeaderContextMenu } }, [onToggleCollapse, onHeaderContextMenu])

  // Seed from the scenario only when the open scenario changes (tab switch).
  // The guard makes our own persist writes (which replace `scenario.nodes`)
  // no-ops here, so selection / drag state survives a move.
  useEffect(() => {
    if (seededId.current === scenario.id) return
    seededId.current = scenario.id
    nodeStore.current = new Map(scenario.nodes.map((n) => [n.id, n]))
    edgeStore.current = new Map(scenario.edges.map((e) => [e.id, e]))
    setNodes(scenario.nodes.map((n) => toFlowNode(n, handlers.current)))
    setEdges(scenario.edges.map(toFlowEdge))
  }, [scenario.id, scenario.nodes, scenario.edges, setNodes, setEdges])

  const handleNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    onNodesChange(changes)
    // Node removals (Delete/Backspace on a selection) — drop them from the
    // authoritative store, close any open menu, and persist.
    const removed = changes.filter((c): c is Extract<NodeChange<Node<NodeData>>, { type: 'remove' }> => c.type === 'remove')
    if (removed.length > 0) {
      removed.forEach((c) => { nodeStore.current.delete(c.id) })
      setNodeMenu(null)
      setNodes((curr) => { setEdges((e) => { persist(curr, e); return e }); return curr })
      return
    }
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

  const addNode = useCallback((kind: ScenarioNodeKind, flow: { x: number; y: number }, config: Record<string, unknown> = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { inputs, outputs } = defaultPortsForKind(kind)
    const node: ScenarioNode = { id, kind, config, inputs, outputs, position: flow }
    nodeStore.current.set(id, node)
    setNodes((curr) => {
      const next = [...curr, toFlowNode(node, handlers.current)]
      setEdges((e) => { persist(next, e); return e })
      return next
    })
    setPalette(null)
  }, [setNodes, setEdges, persist])

  const onDragOver = useCallback((event: React.DragEvent) => {
    // Allow the drop only when the host can resolve dragged items.
    if (!resolveBoundItem) return
    event.preventDefault()
    // Match the source's `effectAllowed` ('move', set by the ListView) — a
    // 'copy' dropEffect against a 'move'-only source makes the browser reject
    // the drop, so the `drop` event never fires.
    event.dataTransfer.dropEffect = 'move'
  }, [resolveBoundItem])

  const onDrop = useCallback((event: React.DragEvent) => {
    if (!resolveBoundItem) return
    const itemId = event.dataTransfer.getData('text/plain')
    if (!itemId) return
    const item = resolveBoundItem(itemId)
    if (!item) return
    // Request → `request` node, Scenario → `runScenario`; folders/env-folders
    // (anything else) are ignored. The bound id + a fallback label go in config.
    let kind: ScenarioNodeKind
    let config: Record<string, unknown>
    if (isRequest(item)) { kind = 'request'; config = { requestId: item.id, label: item.name } }
    else if (isScenario(item)) { kind = 'runScenario'; config = { scenarioId: item.id, label: item.name } }
    else return
    event.preventDefault()
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addNode(kind, flow, config)
  }, [resolveBoundItem, screenToFlowPosition, addNode])

  // Delete a node + any edges touching it.
  const deleteNode = useCallback((nodeId: string) => {
    setNodeMenu(null)
    setNodes((curr) => {
      const next = curr.filter((n) => n.id !== nodeId)
      setEdges((e) => {
        const ne = e.filter((ed) => ed.source !== nodeId && ed.target !== nodeId)
        persist(next, ne)
        return ne
      })
      return next
    })
  }, [setNodes, setEdges, persist])

  // Duplicate a node (clone config/ports/note/colour) offset from the source.
  const duplicateNode = useCallback((nodeId: string) => {
    setNodeMenu(null)
    const src = nodeStore.current.get(nodeId)
    if (!src) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const clone: ScenarioNode = {
      ...src,
      id,
      position: { x: src.position.x + 40, y: src.position.y + 40 },
      config: { ...src.config },
      inputs: src.inputs.map((p) => ({ ...p })),
      outputs: src.outputs.map((p) => ({ ...p }))
    }
    nodeStore.current.set(id, clone)
    setNodes((curr) => {
      const next = [...curr.map((n) => ({ ...n, selected: false })), { ...toFlowNode(clone, handlers.current), selected: true }]
      setEdges((e) => { persist(next, e); return e })
      return next
    })
  }, [setNodes, setEdges, persist])

  // Open the colour picker anchored to a node's header.
  const openColorPicker = useCallback((nodeId: string) => {
    setNodeMenu(null)
    const el = wrapperRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"] .scn-node-header`)
    colorTargetRef.current = el ?? null
    if (el) setColorPlacement(chooseColorTooltipPlacement(el.getBoundingClientRect()))
    setColorPickerNodeId(nodeId)
  }, [])

  // Set (or, with `undefined`, reset to default) a node's box colour. The
  // `color` key is deleted rather than set to `undefined` (exactOptionalPropertyTypes).
  const setNodeColor = useCallback((nodeId: string, color: string | undefined) => {
    setNodes((curr) => {
      const next = curr.map((fn) => {
        if (fn.id !== nodeId) return fn
        const data = { ...fn.data }
        if (color === undefined) delete data.color
        else data.color = color
        return { ...fn, data }
      })
      const prior = nodeStore.current.get(nodeId)
      if (prior) {
        const updated = { ...prior }
        if (color === undefined) delete updated.color
        else updated.color = color
        nodeStore.current.set(nodeId, updated)
      }
      setEdges((e) => { persist(next, e); return e })
      return next
    })
  }, [setNodes, setEdges, persist])

  const openNoteEditor = useCallback((nodeId: string) => {
    setNodeMenu(null)
    setNoteDraft(nodeStore.current.get(nodeId)?.note ?? '')
    setNoteEditorNodeId(nodeId)
  }, [])

  // Persist a node's note; an empty (trimmed) note is treated as no note.
  const setNodeNote = useCallback((nodeId: string, rawNote: string) => {
    const note = rawNote.trim() === '' ? undefined : rawNote
    setNodes((curr) => {
      const next = curr.map((fn) => {
        if (fn.id !== nodeId) return fn
        const data = { ...fn.data }
        if (note === undefined) delete data.note
        else data.note = note
        return { ...fn, data }
      })
      const prior = nodeStore.current.get(nodeId)
      if (prior) {
        const updated = { ...prior }
        if (note === undefined) delete updated.note
        else updated.note = note
        nodeStore.current.set(nodeId, updated)
      }
      setEdges((e) => { persist(next, e); return e })
      return next
    })
  }, [setNodes, setEdges, persist])

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
    <ScenarioBoundResolverContext.Provider value={resolveBoundItem ?? null}>
    <ScenarioRequestEnvContext.Provider value={resolveRequestEnv ?? null}>
    <div ref={wrapperRef} data-testid="scenario-editor" style={containerStyle} onDragOver={onDragOver} onDrop={onDrop}>
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
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Control', 'Meta']}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => { setPalette(null); setNodeMenu(null); setColorPickerNodeId(null) }}
        onNodeClick={() => { setNodeMenu(null); setColorPickerNodeId(null) }}
        onMoveStart={() => { setNodeMenu(null); setPalette(null); setColorPickerNodeId(null) }}
        onNodeDragStart={() => { setNodeMenu(null); setColorPickerNodeId(null) }}
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
      {nodeMenu && (
        <ContextMenu
          visible
          x={nodeMenu.x}
          y={nodeMenu.y}
          onRequestClose={() => { setNodeMenu(null) }}
          data-testid="scenario-node-menu"
          items={[
            { id: 'color', label: t('scenario.node.menu.changeColor', 'Change colour'), icon: 'symbol-color', opensDialog: true, onClick: () => { openColorPicker(nodeMenu.nodeId) } },
            { id: 'note', label: t('scenario.node.menu.addNote', 'Add note'), icon: 'note', opensDialog: true, onClick: () => { openNoteEditor(nodeMenu.nodeId) } },
            { id: 'sep1', label: '', isSeparator: true },
            { id: 'duplicate', label: t('scenario.node.menu.duplicate', 'Duplicate'), icon: 'copy', onClick: () => { duplicateNode(nodeMenu.nodeId) } },
            { id: 'sep2', label: '', isSeparator: true },
            { id: 'delete', label: t('scenario.node.menu.delete', 'Delete'), icon: 'trash', shortcut: t('scenario.node.menu.deleteShortcut', 'Del'), onClick: () => { deleteNode(nodeMenu.nodeId) } }
          ]}
        />
      )}
      <Tooltip
        targetRef={colorTargetRef}
        show={colorPickerNodeId !== null}
        repositionKey={colorPickerNodeId}
        data-testid="scenario-node-color-picker-tooltip"
        placement={colorPlacement.placement}
        side={colorPlacement.side}
        content={
          <div onMouseDown={(e) => { e.stopPropagation() }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ColorPicker
              value={(colorPickerNodeId ? nodes.find((n) => n.id === colorPickerNodeId)?.data.color : undefined) ?? '#3b82f6'}
              onChange={(color) => { if (colorPickerNodeId) setNodeColor(colorPickerNodeId, color) }}
              disableAlpha
              data-testid="scenario-node-color-picker"
            />
            <Button
              secondary
              fullWidth
              icon="trash"
              onClick={() => { if (colorPickerNodeId) { setNodeColor(colorPickerNodeId, undefined); setColorPickerNodeId(null) } }}
              options={{ ariaLabel: t('scenario.node.menu.resetColor', 'Reset colour'), title: t('scenario.node.menu.resetColor', 'Reset colour') }}
              data-testid="scenario-node-color-reset"
            />
          </div>
        }
      />
      <Modal
        title={t('scenario.node.menu.addNote', 'Add note')}
        isOpen={noteEditorNodeId !== null}
        onClose={() => { setNoteEditorNodeId(null) }}
        size="dialog"
        data-testid="scenario-node-note-modal"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 420, height: 300, boxSizing: 'border-box' }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', maxWidth: '100%' }}>
            <MarkdownEditor key={noteEditorNodeId ?? 'none'} initialValue={noteDraft} onChange={setNoteDraft} data-testid="scenario-node-note-editor" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button secondary onClick={() => { setNoteEditorNodeId(null) }}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={() => { if (noteEditorNodeId) setNodeNote(noteEditorNodeId, noteDraft); setNoteEditorNodeId(null) }}>{t('common.save', 'Save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
    </ScenarioRequestEnvContext.Provider>
    </ScenarioBoundResolverContext.Provider>
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
