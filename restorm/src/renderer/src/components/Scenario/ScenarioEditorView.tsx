import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
  type EdgeChange,
  type OnConnectStart,
  type OnConnectEnd
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { Button, ContextMenu, Tooltip, ColorPicker, Modal, MarkdownEditor, type ContextMenuItem } from 'electron-core-ui/renderer'
import type { Scenario, ScenarioNode, ScenarioEdge, ScenarioNodeKind } from '../../../../shared/types/collections'
import { isRequest, isScenario } from '../../../../shared/types/collections'
import { Badge } from '../common/Badge'
import { requestBadgeType } from '../../utils/badgeUtils'
import { ScenarioBoundResolverContext, ScenarioRequestEnvContext, type ResolveBoundItem, type ResolveRequestEnv } from './scenarioBoundResolver'
import { ScenarioEdgeSelectorContext, type ScenarioEdgeSelectorApi } from './scenarioEdgeSelector'
import { ScenarioStaticPreviewContext, type ScenarioStaticPreviewApi, type ObjectWiredProperty } from './scenarioStaticPreviewContext'
import { ScenarioVariablesContext, type ScenarioVariable } from '../../contexts/ScenarioVariablesContext'
import { resolveValueTypeKind } from '../TypedValueField/castValue'
import { normalizeValueType } from '../../utils/normalizeValueType'
import { SCENARIO_NODE_CATALOGUE, scenarioNodeMeta, type ScenarioNodeKindMeta } from './scenarioNodeCatalogue'
import { scenarioEdgeToFlowEdge, flowEdgeToScenarioEdge, portColor } from './scenarioGraphMapping'
import { ScenarioNodeView, type ScenarioNodeBoxData } from './nodes'
import { defaultPortsForKind, isValidScenarioConnection, deriveRunScenarioPorts, inputPortFlow, outputPortFlow } from './scenarioNodePorts'
import { isDataLink } from './scenarioPathTree'
import { linkPaletteEntries } from './scenarioLinkPalette'
import { SCENARIO_ADD_REQUEST_GROUPS, SCENARIO_ADD_SCENARIO_ENTRY, scenarioAddIcon } from './scenarioChildPalette'
import type { AddChildKind } from '../MainView/Sidebar/contextMenuBuilder'
import { validateScenarioGraph, targetKey, type ScenarioNodeError, type ScenarioDataLink } from './scenarioValidation'
import { ScenarioErrorsContext } from './scenarioErrorsContext'
import { ScenarioInspectorPanel, type InspectorPreviewNode } from './ScenarioInspectorPanel'
import { staticScenarioPreview, singleDeepPath, expectsObjectInput, singleTopLevelKey, STATIC_PREVIEW_KINDS, resolveItems, applyListOp, resolveSelectorPath, type StaticPreviewNode, type StaticPreviewEdge } from '../../../../shared/utils/scenarioStaticPreview'
import { consumePendingScenarioNodeFocus, onScenarioNodeFocus, clearPendingScenarioNodeFocus } from '../../services/scenarioFocusBus'
import { dynamicHandleIds, pruneOrphanDynamicEdges, isOrphanDynamicEdge } from './orphanEdgeSanitizer'

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
  /** Open a tree item (bound request / sub-scenario) in a workbench tab by id —
   * drives the "Edit request / scenario" link on those nodes. */
  onOpenItem?: (itemId: string) => void
  /** Create a new HTTP request as a child of this scenario and return its id —
   * called when a "Requête HTTP" node is added to the graph so it binds to a
   * freshly-created request (placed under the scenario in the sidebar). */
  onCreateRequest?: (scenarioId: string) => string | null
  /** Create a child item of the given kind (request protocol or sub-scenario)
   * under this scenario, returning its id — drives the add-palette "Add"
   * submenu: the item lands in the sidebar AND the editor binds its node. */
  onCreateChild?: (scenarioId: string, kind: AddChildKind) => string | null
}

type NodeData = ScenarioNodeBoxData

const nodeTypes = { scenarioNode: ScenarioNodeView }

const containerStyle: CSSProperties = { width: '100%', height: '100%', position: 'relative' }
const emptyStyle: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  pointerEvents: 'none', opacity: 0.6, fontSize: 13, zIndex: 1
}
const invalidBannerStyle: CSSProperties = {
  position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
  display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none',
  padding: '4px 10px', borderRadius: 4, fontSize: 12,
  background: 'var(--inputValidation-errorBackground, #5a1d1d)',
  color: 'var(--inputValidation-errorForeground, #fff)',
  border: '1px solid var(--inputValidation-errorBorder, #be1100)'
}
/** The catalogue flattened with a separator marker between categories — the
 * add-node menu maps this to ContextMenu items. Computed once (no refs / no
 * render-phase work). */
const PALETTE_ENTRIES: (ScenarioNodeKindMeta | { separator: true })[] = SCENARIO_NODE_CATALOGUE.flatMap(
  (meta, i, arr) => (i > 0 && arr[i - 1]?.category !== meta.category ? [{ separator: true as const }, meta] : [meta])
)

/** Catalogue meta by kind — label/icon lookup for the filtered link palette. */
const META_BY_KIND = new Map<ScenarioNodeKind, ScenarioNodeKindMeta>(SCENARIO_NODE_CATALOGUE.map((m) => [m.kind, m]))

interface NodeHandlers {
  scenarioId: string
  onToggleCollapse: (id: string) => void
  onHeaderContextMenu: (id: string, x: number, y: number) => void
  onSetConfig: (id: string, config: Record<string, unknown>) => void
  onOpenItem?: (itemId: string) => void
}

function toFlowNode(n: ScenarioNode, handlers: NodeHandlers): Node<NodeData> {
  return {
    id: n.id,
    type: 'scenarioNode',
    position: n.position,
    data: {
      kind: n.kind,
      scenarioId: handlers.scenarioId,
      inputs: n.inputs,
      outputs: n.outputs,
      config: n.config,
      onToggleCollapse: handlers.onToggleCollapse,
      onHeaderContextMenu: handlers.onHeaderContextMenu,
      onSetConfig: handlers.onSetConfig,
      ...(handlers.onOpenItem ? { onOpenItem: handlers.onOpenItem } : {}),
      ...(n.note !== undefined ? { note: n.note } : {}),
      ...(n.color !== undefined ? { color: n.color } : {}),
      ...(n.collapsed !== undefined ? { collapsed: n.collapsed } : {})
    }
  }
}

/**
 * Count required inputs left unsatisfied across the graph — a required port
 * (from the kind's canonical ports, which is what the boxes render) with no
 * incoming edge. A non-zero count makes the scenario invalid / non-runnable.
 * (Literal-value satisfaction lands with the per-slot config model.)
 */
function countUnsatisfiedRequired(
  flowNodes: Node<NodeData>[],
  flowEdges: Edge[],
  resolveScenario: (id: string) => Scenario | null
): number {
  let n = 0
  for (const node of flowNodes) {
    const required = defaultPortsForKind(node.data.kind).inputs.filter((i) => i.required)
    // A runScenario's required inputs are its sub-scenario's required params (derived).
    if (node.data.kind === 'runScenario') {
      const subId = typeof node.data.config?.['scenarioId'] === 'string' ? node.data.config['scenarioId'] : undefined
      const sub = subId ? resolveScenario(subId) : null
      required.push(...deriveRunScenarioPorts(sub).inputs.filter((i) => i.required))
    }
    for (const inp of required) {
      if (!flowEdges.some((e) => e.target === node.id && e.targetHandle === inp.id)) n++
    }
  }
  return n
}

/**
 * Pick the colour-picker tooltip placement around a node header, by the
 * user's priority: above → right → left → below (below = under the
 * header, over the body). Falls through to below when nothing fits.
 */
/** React Flow's pane / node / edge handlers intercept the underlying
 * `mousedown` for pan + drag, so global `mousedown` listeners attached to
 * `document` by tooltips / popovers / suggest widgets elsewhere in the app
 * never fire when the user interacts with the scenario canvas. Calling this
 * after each click on a React Flow surface dismisses every off-canvas
 * "close-on-outside-click" popover at once:
 *   1. dispatch a synthetic `mousedown` on `document.body` so every
 *      "outside click" listener (capture or bubble) sees a target outside
 *      its popover and closes.
 *   2. blur the active element ONLY when it lives outside the canvas — an
 *      input inside a scenario node must keep focus when its host node is
 *      clicked, otherwise the user can never type into it. The titlebar
 *      search, command palette, etc. live outside `.react-flow`, so they
 *      still blur and dismiss. */
function dismissOffCanvasPopovers(): void {
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body && !active.closest('.react-flow')) {
    active.blur()
  }
}

/** The "leaf" identifier of a JSON-path selector — the last name-like segment
 * (e.g. `response.body.items[0].name` → `"name"`, `now` → `"now"`). Returns
 * null for paths ending on a numeric index or anything malformed, so callers
 * never propose a nonsense name. */
function leafSegment(path: string): string | null {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\['([^']*)'\]/g, '.$1')
    .replace(/\["([^"]*)"\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  const last = segments[segments.length - 1]
  if (!last || !/^[A-Za-z_$][\w$]*$/.test(last)) return null
  return last
}

function chooseColorTooltipPlacement(rect: DOMRect): { placement: 'above' | 'below'; side: 'auto' | 'left' | 'right' } {
  const W = 232
  const H = 300
  const gap = 14
  if (rect.top >= H + gap) return { placement: 'above', side: 'auto' }
  if (window.innerWidth - rect.right >= W + gap) return { placement: 'below', side: 'right' }
  if (rect.left >= W + gap) return { placement: 'below', side: 'left' }
  return { placement: 'below', side: 'auto' }
}

const ScenarioEditorCanvas: React.FC<ScenarioEditorViewProps> = ({ scenario, onScenarioChange, resolveBoundItem, resolveRequestEnv, onOpenItem, onCreateRequest, onCreateChild }) => {
  const { t } = useTranslation()
  const { screenToFlowPosition, fitView } = useReactFlow()
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
      // Serialize the LIVE React Flow node data, not the authoritative store:
      // `setNodeConfig` always updates `fn.data.config`, but the matching
      // `nodeStore` write can lag for out-of-band (MCP-created) nodes, leaving
      // `prior.config` stale — which is why successive config edits persisted
      // only the first. The store stays the fallback for `config` (the only
      // optional field on the node data); `inputs`/`outputs` are always carried.
      return {
        id: fn.id,
        kind: fn.data.kind,
        config: fn.data.config ?? prior?.config ?? {},
        inputs: fn.data.inputs,
        outputs: fn.data.outputs,
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
    // Defer the parent update. `persist` is sometimes called inside a
    // `setNodes`/`setEdges` updater (notably from `setNodeConfig`), and calling
    // `onScenarioChange` (→ `setState` on App) synchronously from there trips
    // React's "cannot update a component while rendering a different one" and
    // the update is dropped — which is why scenario config edits never reached
    // the parent (and thus never autosaved). A microtask runs it after commit.
    queueMicrotask(() => { onScenarioChange?.(scenario.id, { nodes: nextNodes, edges: nextEdges }) })
  }, [onScenarioChange, scenario.id])

  // The JSON-path selector on a data link reads + writes that edge's `selector`
  // through this api; the write mutates the authoritative edge store, mirrors it
  // onto the flow edge's `data` (so validation reads it from render state), and
  // re-persists (the seed guard keeps it from re-seeding the canvas).
  const getEdgeSelector = useCallback((edgeId: string) => edgeStore.current.get(edgeId)?.selector, [])
  const setEdgeSelector = useCallback((edgeId: string, selector: string) => {
    const prior = edgeStore.current.get(edgeId)
    if (!prior) return
    const trimmed = selector.trim()
    const updated: ScenarioEdge = { ...prior }
    if (trimmed === '') delete updated.selector
    else updated.selector = trimmed
    edgeStore.current.set(edgeId, updated)
    // The leaf of the picked path is a candidate name for an unnamed object
    // property: typing / dragging / clicking a path in the picker mirrors that
    // leaf into the destination property's name (only when empty, so we never
    // clobber a deliberate rename).
    const leaf = trimmed ? leafSegment(trimmed) : null
    setNodes((n) => {
      let nextNodes = n
      if (leaf) {
        const target = n.find((x) => x.id === prior.to.nodeId)
        if (target?.data.kind === 'object') {
          const propsRaw = target.data.config?.['properties']
          const props = Array.isArray(propsRaw) ? (propsRaw as { id?: unknown; name?: unknown }[]) : []
          const prop = props.find((p) => p.id === prior.to.portId)
          if (prop && (typeof prop.name !== 'string' || prop.name.trim() === '')) {
            nextNodes = n.map((nd) => nd.id !== target.id ? nd : {
              ...nd,
              data: {
                ...nd.data,
                config: {
                  ...(nd.data.config ?? {}),
                  properties: props.map((p) => p.id === prior.to.portId ? { ...(p as Record<string, unknown>), name: leaf } : p)
                }
              }
            })
          }
        }
      }
      setEdges((curr) => {
        const next = curr.map((fe) => (fe.id === edgeId ? { ...fe, data: { ...(fe.data ?? {}), selector: trimmed || undefined } } : fe))
        persist(nextNodes, next)
        return next
      })
      return nextNodes
    })
  }, [setNodes, setEdges, persist])
  const edgeSelectorApi = useMemo<ScenarioEdgeSelectorApi>(() => ({ getSelector: getEdgeSelector, setSelector: setEdgeSelector }), [getEdgeSelector, setEdgeSelector])

  // Lookup the static-config-derived preview for any source box. Used by the
  // JSON-path picker so a `STATIC_PREVIEW_KINDS` source (`now`, `input`,
  // `transform`, …) shows its tree immediately — no "run the source" detour.
  const staticPreviewApi = useMemo<ScenarioStaticPreviewApi>(() => ({
    getPreview: (sourceNodeId: string) => {
      const src = nodes.find((n) => n.id === sourceNodeId)
      if (!src) return null
      const staticEdges = edges.flatMap((e) => {
        if (!e.source || !e.target || !e.sourceHandle || !e.targetHandle) return []
        const sel = typeof e.data?.['selector'] === 'string' ? e.data['selector'] : undefined
        return [{ from: { nodeId: e.source, portId: e.sourceHandle }, to: { nodeId: e.target, portId: e.targetHandle }, ...(sel !== undefined ? { selector: sel } : {}) }]
      })
      return staticScenarioPreview(
        { id: src.id, kind: src.data.kind, config: src.data.config ?? {} },
        nodes.map((x) => ({ id: x.id, kind: x.data.kind, config: x.data.config ?? {} })),
        staticEdges
      )
    },
    getObjectWiredProperties: (nodeId: string) => {
      // Return every (preview-key, sourceId, selector) tuple the inspector
      // needs to fetch + inject into the assembled preview, so the user sees
      // the real value instead of a `null` placeholder. Covers:
      //   • `object` — one entry per property whose source isn't static.
      //   • `wait` / `waitUntil` — single entry on the data input.
      const target = nodes.find((n) => n.id === nodeId)
      if (!target) return []
      const out: ObjectWiredProperty[] = []
      const collect = (previewKey: string, portId: string): void => {
        const edge = edges.find((e) => e.target === nodeId && e.targetHandle === portId)
        if (!edge) return
        const source = nodes.find((n) => n.id === edge.source)
        if (!source || STATIC_PREVIEW_KINDS.has(source.data.kind)) return
        const sel = typeof edge.data?.['selector'] === 'string' ? edge.data['selector'] : undefined
        out.push({ name: previewKey, sourceNodeId: source.id, ...(sel !== undefined ? { selector: sel } : {}) })
      }
      if (target.data.kind === 'object') {
        const propsRaw = target.data.config?.['properties']
        const props = Array.isArray(propsRaw) ? (propsRaw as { id?: unknown; name?: unknown }[]) : []
        for (const p of props) {
          if (typeof p.id !== 'string' || typeof p.name !== 'string' || p.name === '') continue
          collect(p.name, p.id)
        }
      } else if (target.data.kind === 'wait') {
        collect('duration', 'duration')
      } else if (target.data.kind === 'waitUntil') {
        collect('until', 'until')
      } else if (target.data.kind === 'log') {
        collect('message', 'message')
        collect('data', 'data')
      }
      return out
    },
    getListItemShape: (listNodeId: string) => {
      const target = nodes.find((n) => n.id === listNodeId)
      if (!target) return null
      const cfg = target.data.config ?? {}
      const mappedNodes = nodes.map((x) => ({ id: x.id, kind: x.data.kind, config: x.data.config ?? {} }))
      const mappedEdges = edges.flatMap((e) => {
        if (!e.source || !e.target || !e.sourceHandle || !e.targetHandle) return []
        const sel = typeof e.data?.['selector'] === 'string' ? e.data['selector'] : undefined
        return [{ from: { nodeId: e.source, portId: e.sourceHandle }, to: { nodeId: e.target, portId: e.targetHandle }, ...(sel !== undefined ? { selector: sel } : {}) }]
      })
      const items = resolveItems(listNodeId, cfg, mappedNodes, mappedEdges)
      if (!items || items.length === 0) return null
      const first = items[0]
      if (!first || typeof first !== 'object' || Array.isArray(first)) return null
      return first as Record<string, unknown>
    },
    getRunScenarioOutputs: (runScenarioNodeId: string) => {
      // Resolve the bound sub-scenario, then for each Output node compute
      // its value via the static-preview machinery applied to the
      // sub-scenario's own nodes + edges. Sources without a static preview
      // (httpRequest, …) leave the slot at `null`; the user runs the box to
      // see actuals.
      const runNode = nodes.find((n) => n.id === runScenarioNodeId)
      if (runNode?.data.kind !== 'runScenario') return null
      const runCfg = runNode.data.config ?? {}
      const subId = typeof runCfg['scenarioId'] === 'string' ? runCfg['scenarioId'] : null
      if (!subId) return null
      const subItem = resolveBoundItem?.(subId) ?? null
      const sub = subItem && isScenario(subItem) ? subItem : null
      if (!sub) return null
      const subNodes: StaticPreviewNode[] = sub.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config }))
      const subEdges: StaticPreviewEdge[] = sub.edges.map((e) => ({ from: e.from, to: e.to, ...(e.selector !== undefined ? { selector: e.selector } : {}) }))
      const out: Record<string, unknown> = {}
      for (const node of sub.nodes) {
        if (node.kind !== 'output') continue
        const name = typeof node.config['name'] === 'string' ? node.config['name'] : ''
        if (!name) continue
        const incoming = subEdges.find((e) => e.to.nodeId === node.id && e.to.portId === 'value')
        if (!incoming) { out[name] = null; continue }
        const source = subNodes.find((n) => n.id === incoming.from.nodeId)
        if (!source || !STATIC_PREVIEW_KINDS.has(source.kind)) { out[name] = null; continue }
        const sp = staticScenarioPreview(source, subNodes, subEdges)
        if (sp === null) { out[name] = null; continue }
        const v = incoming.selector ? resolveSelectorPath(sp, incoming.selector) : sp
        out[name] = v === undefined ? null : v
      }
      return out
    }
  }), [nodes, edges, resolveBoundItem])

  // Resolve a scenario reference (a runScenario's sub-scenario) to derive its
  // ports — for orphan-edge detection and the required-input validity count.
  const resolveScenario = useCallback((sid: string): Scenario | null => {
    const it = resolveBoundItem?.(sid) ?? null
    return it && isScenario(it) ? it : null
  }, [resolveBoundItem])

  // Ports a runScenario node derives from its bound sub-scenario (one per named
  // input/output node, plus a `done` trigger when it returns nothing) — null for
  // any other kind. Accepts both the stored `ScenarioNode` and the flow node's
  // `data`, since both carry `{ kind, config }`.
  const derivedPortsOf = useCallback((node: { kind: ScenarioNodeKind; config?: Record<string, unknown> } | undefined) => {
    if (node?.kind !== 'runScenario') return null
    const sid = typeof node.config?.['scenarioId'] === 'string' ? node.config['scenarioId'] : undefined
    return deriveRunScenarioPorts(sid ? resolveScenario(sid) : null)
  }, [resolveScenario])

  // Whether an edge endpoint still resolves to a live port on a runScenario
  // node. A runScenario's ports are derived from its sub-scenario's input /
  // output nodes, so renaming or deleting a param there strands edges that
  // referenced the old port id — those become orphans we flag in red.
  const isOrphanEdge = useCallback((e: ScenarioEdge): boolean => {
    const tgtDerived = derivedPortsOf(nodeStore.current.get(e.to.nodeId))
    if (tgtDerived && !tgtDerived.inputs.some((p) => p.id === e.to.portId)) return true
    const srcDerived = derivedPortsOf(nodeStore.current.get(e.from.nodeId))
    if (srcDerived && !srcDerived.outputs.some((p) => p.id === e.from.portId)) return true
    return false
  }, [derivedPortsOf])

  // A scenario edge → React Flow edge, with its stroke resolved: an explicit
  // `Edge.color` override wins, otherwise the source port's role colour
  // (then=green / else=blue / response=green / error=red / …), else neutral.
  // An orphaned edge (endpoint port gone after a sub-scenario rename) overrides
  // both, drawn red + dashed so the stale wiring is obvious.
  const buildFlowEdge = useCallback((e: ScenarioEdge): Edge => {
    const fe = scenarioEdgeToFlowEdge(e) as Edge
    // Carry the JSON-path selector in edge data so validation can read it from
    // render state (not the edgeStore ref).
    const withSel = (edge: Edge): Edge => (e.selector ? { ...edge, data: { ...(edge.data ?? {}), selector: e.selector } } : edge)
    if (isOrphanEdge(e)) {
      return withSel({ ...fe, className: 'scn-edge-orphan', data: { ...(fe.data ?? {}), orphan: true }, style: { ...(fe.style ?? {}), stroke: 'var(--scn-edge-orphan, #e5484d)', strokeDasharray: '5 4' } })
    }
    const src = nodeStore.current.get(e.from.nodeId)
    // A runScenario's outputs are derived, so fall back to the derived set to
    // colour edges off its `response` / `done` ports.
    const port = src?.outputs.find((o) => o.id === e.from.portId)
      ?? derivedPortsOf(src)?.outputs.find((o) => o.id === e.from.portId)
    const stroke = e.color ?? (port ? portColor(port) : undefined)
    return withSel(stroke ? { ...fe, style: { ...(fe.style ?? {}), stroke } } : fe)
  }, [isOrphanEdge, derivedPortsOf])

  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  const [edgeColorPicker, setEdgeColorPicker] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  // Cursor-anchored invisible target for the edge colour-picker tooltip (edges
  // have no stable DOM element to pin a beak to, unlike a node header).
  const edgeColorAnchorRef = useRef<HTMLDivElement>(null)

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

  // Merge a patch into a node's per-kind config bag; update the live node +
  // the authoritative store + persist. Modeled on `setNodeColor`.
  const setNodeConfig = useCallback((nodeId: string, config: Record<string, unknown>) => {
    setNodes((curr) => {
      const next = curr.map((fn) => {
        if (fn.id !== nodeId) return fn
        const merged = { ...(fn.data.config ?? {}), ...config }
        return { ...fn, data: { ...fn.data, config: merged } }
      })
      const prior = nodeStore.current.get(nodeId)
      if (prior) {
        nodeStore.current.set(nodeId, { ...prior, config: { ...prior.config, ...config } })
      } else {
        // Seed the authoritative store from the live node when it's missing
        // (out-of-band / MCP-created), so this + later persists keep its config.
        const fn = next.find((n) => n.id === nodeId)
        if (fn) {
          nodeStore.current.set(nodeId, {
            id: nodeId,
            kind: fn.data.kind,
            config: { ...(fn.data.config ?? {}) },
            inputs: fn.data.inputs,
            outputs: fn.data.outputs,
            position: fn.position
          })
        }
      }
      // Object property / switch case removal drops a dynamic handle but
      // doesn't itself touch edges — the edge entry survives as an orphan
      // pointing at a handle that no longer exists, which spams React Flow's
      // "couldn't create edge for target handle id" warning every render.
      // Catch it at the config-write boundary: filter edges whose dynamic
      // handle just vanished, then re-persist.
      const target = next.find((n) => n.id === nodeId)
      const dyn = target ? dynamicHandleIds(target.data.kind, target.data.config) : null
      setEdges((e) => {
        const pruned = dyn ? pruneOrphanDynamicEdges(e, nodeId, dyn.ids, dyn.prefix) : e
        if (pruned !== e) {
          for (const dropped of e) {
            if (!pruned.includes(dropped)) edgeStore.current.delete(dropped.id)
          }
        }
        persist(next, pruned)
        return pruned
      })
      return next
    })
  }, [setNodes, setEdges, persist])

  const handlers = useRef<NodeHandlers>({ scenarioId: scenario.id, onToggleCollapse, onHeaderContextMenu, onSetConfig: setNodeConfig, ...(onOpenItem ? { onOpenItem } : {}) })
  useEffect(() => { handlers.current = { scenarioId: scenario.id, onToggleCollapse, onHeaderContextMenu, onSetConfig: setNodeConfig, ...(onOpenItem ? { onOpenItem } : {}) } }, [scenario.id, onToggleCollapse, onHeaderContextMenu, setNodeConfig, onOpenItem])

  // Seed from the scenario only when the open scenario changes (tab switch).
  // The guard makes our own persist writes (which replace `scenario.nodes`)
  // no-ops here, so selection / drag state survives a move.
  useEffect(() => {
    if (seededId.current === scenario.id) return
    seededId.current = scenario.id
    // Pre-existing scenarios may carry edges left orphaned by an earlier property
    // / case removal (the bug class fixed in `setNodeConfig`). Drop them once at
    // load so the persisted file converges with what the editor can actually
    // render — and the console isn't flooded with React Flow handle warnings.
    const nodeBy = new Map(scenario.nodes.map((n) => [n.id, n]))
    const cleanEdges = scenario.edges.filter((e) => !isOrphanDynamicEdge(
      { source: e.from.nodeId, target: e.to.nodeId, sourceHandle: e.from.portId, targetHandle: e.to.portId },
      (id) => nodeBy.get(id)
    ))
    nodeStore.current = new Map(scenario.nodes.map((n) => [n.id, n]))
    edgeStore.current = new Map(cleanEdges.map((e) => [e.id, e]))
    setNodes(scenario.nodes.map((n) => toFlowNode(n, handlers.current)))
    setEdges(cleanEdges.map(buildFlowEdge))
    if (cleanEdges.length !== scenario.edges.length) {
      // Schedule a persist so the cleanup makes it back to disk on the next
      // autosave. Defer to a microtask: the parent owns scenario state, and a
      // synchronous patch dispatch from inside this effect would race the
      // initial render that just seeded the editor.
      queueMicrotask(() => { onScenarioChange?.(scenario.id, { edges: cleanEdges }) })
    }
  }, [scenario.id, scenario.nodes, scenario.edges, setNodes, setEdges, buildFlowEdge, onScenarioChange])

  // Sweep dynamic-handle orphan edges whenever the node set / its configs
  // change. Three motivations:
  //  - persisted scenarios saved before the sanitizer existed (the load effect
  //    catches these once, but only when its `seededId` guard fires — HMR
  //    preserves the ref and short-circuits),
  //  - belt-and-braces for the `setNodeConfig` cleanup,
  //  - any future code path that drops a port without touching edges.
  // The filter is idempotent: when there are no orphans, the result === current
  // edges and React Flow doesn't re-render.
  useEffect(() => {
    setEdges((curr) => {
      const nodeBy = (id: string): { kind: ScenarioNodeKind; config?: Record<string, unknown> } | undefined => {
        const n = nodes.find((x) => x.id === id)
        if (!n) return undefined
        return n.data.config !== undefined ? { kind: n.data.kind, config: n.data.config } : { kind: n.data.kind }
      }
      const next = curr.filter((edge) => !isOrphanDynamicEdge(edge, nodeBy))
      if (next.length === curr.length) return curr
      for (const e of curr) if (!next.includes(e)) edgeStore.current.delete(e.id)
      queueMicrotask(() => { persist(nodes, next) })
      return next
    })
  }, [nodes, setEdges, persist])

  // Re-seed when this scenario is mutated externally by the MCP tools
  // (create/move/update/delete node, connect/disconnect). Deliberately
  // bypasses the seededId guard — these aren't our own edits, so the open
  // editor must repaint from the incoming graph.
  useEffect(() => {
    const api = (window as { restorm?: { runtime?: { onMcpScenarioUpdated?: (cb: (p: { scenarioId: string; nodes: unknown[]; edges: unknown[] }) => void) => () => void } } }).restorm?.runtime
    if (!api?.onMcpScenarioUpdated) return
    return api.onMcpScenarioUpdated(({ scenarioId, nodes, edges }) => {
      if (scenarioId !== scenario.id) return
      const ns = nodes as ScenarioNode[]
      const es = edges as Scenario['edges']
      nodeStore.current = new Map(ns.map((n) => [n.id, n]))
      edgeStore.current = new Map(es.map((e) => [e.id, e]))
      setNodes(ns.map((n) => toFlowNode(n, handlers.current)))
      setEdges(es.map(buildFlowEdge))
    })
  }, [scenario.id, setNodes, setEdges, buildFlowEdge])

  // Centre on a box when navigated here from a request's "used in scenarios"
  // link. A pending request set just before the tab opened is read on mount; a
  // live request (tab already open) arrives through the focus bus. Either way
  // we wait until the target node is seeded before fitting the view.
  const focusTargetRef = useRef<string | null>(null)
  const tryFocusNode = useCallback(() => {
    const id = focusTargetRef.current
    if (!id || !nodes.some((n) => n.id === id)) return
    focusTargetRef.current = null
    void fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.2 })
  }, [nodes, fitView])
  useEffect(() => { focusTargetRef.current = consumePendingScenarioNodeFocus(scenario.id) ?? null }, [scenario.id])
  useEffect(() => { tryFocusNode() }, [tryFocusNode])
  useEffect(() => onScenarioNodeFocus((scenarioId, nodeId) => {
    if (scenarioId !== scenario.id) return
    clearPendingScenarioNodeFocus(scenario.id)
    focusTargetRef.current = nodeId
    tryFocusNode()
  }), [scenario.id, tryFocusNode])

  // Report React-Flow-measured node rects (position + size) to main, debounced.
  // Size isn't in the model, so this lets the scenario MCP read tools expose
  // box sizes — an agent can then place boxes without overlap, no screenshots.
  useEffect(() => {
    const api = (window as { restorm?: { runtime?: { pushScenarioLayout?: (p: { scenarioId: string; rects: Record<string, { x: number; y: number; width: number; height: number }> }) => void } } }).restorm?.runtime
    const push = api?.pushScenarioLayout
    if (!push) return
    const t = setTimeout(() => {
      const rects: Record<string, { x: number; y: number; width: number; height: number }> = {}
      for (const n of nodes) {
        const w = n.measured?.width ?? n.width
        const h = n.measured?.height ?? n.height
        if (w != null && h != null) rects[n.id] = { x: n.position.x, y: n.position.y, width: w, height: h }
      }
      if (Object.keys(rects).length > 0) push({ scenarioId: scenario.id, rects })
    }, 250)
    return () => { clearTimeout(t) }
  }, [nodes, scenario.id])

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

  // Block links that don't make sense by port flow class (value / signal /
  // both): a value output can't feed the header trigger, a signal output
  // can't feed a data input, etc. Drives React Flow's drag-time validity.
  const validateConnection = useCallback((c: Connection | Edge): boolean => {
    if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false
    const src = nodes.find((n) => n.id === c.source)
    const tgt = nodes.find((n) => n.id === c.target)
    if (!src || !tgt) return false
    // A non-header input accepts a single incoming link: reject a new link onto
    // an already-wired data input (the existing one stays). The header launch
    // trigger (`in`) keeps MERGE — multiple incoming links allowed there.
    if (c.targetHandle !== 'in' && edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle)) {
      return false
    }
    // A runScenario exposes derived param/output ports (incl. the `done`
    // trigger), so merge them in for both endpoints before checking flow.
    const srcDerived = derivedPortsOf(src.data)
    const tgtDerived = derivedPortsOf(tgt.data)
    return isValidScenarioConnection({
      sourceKind: src.data.kind,
      sourceOutputs: srcDerived ? [...src.data.outputs, ...srcDerived.outputs] : src.data.outputs,
      sourceHandle: c.sourceHandle,
      targetKind: tgt.data.kind,
      targetInputs: tgtDerived ? [...tgt.data.inputs, ...tgtDerived.inputs] : tgt.data.inputs,
      targetHandle: c.targetHandle
    })
  }, [nodes, edges, derivedPortsOf])

  const onConnect = useCallback((connection: Connection) => {
    if (!validateConnection(connection)) return
    const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const src = nodes.find((n) => n.id === connection.source)
    const tgt = nodes.find((n) => n.id === connection.target)
    const port = src?.data.outputs.find((o) => o.id === connection.sourceHandle)
      ?? (src ? derivedPortsOf(src.data)?.outputs.find((o) => o.id === connection.sourceHandle) : undefined)
    const stroke = port ? portColor(port) : undefined
    // Auto-fill the JSON path when a data link's source has an unambiguous
    // (single-deep) preview — e.g. a getVariable `{ timer }` link deduces
    // `timer` outright, so the user needn't open the picker.
    let selector: string | undefined
    if (src && tgt && connection.sourceHandle && connection.targetHandle) {
      const srcDerived = derivedPortsOf(src.data)?.outputs ?? []
      const outFlow = outputPortFlow([...src.data.outputs, ...srcDerived], connection.sourceHandle, src.data.kind)
      const inFlow = inputPortFlow(tgt.data.inputs, connection.targetHandle, tgt.data.kind)
      if (isDataLink(inFlow, outFlow) && expectsObjectInput(tgt.data.kind, connection.targetHandle)) {
        // Object-context input: if the source's preview narrows to a single
        // top-level key, mirror it (the most natural shortcut); otherwise
        // default to the identity selector `.` (whole object flows through).
        const preview = STATIC_PREVIEW_KINDS.has(src.data.kind)
          ? staticScenarioPreview(
              { id: src.id, kind: src.data.kind, config: src.data.config ?? {} },
              nodes.map((x) => ({ id: x.id, kind: x.data.kind, config: x.data.config ?? {} })),
              edges.flatMap((e) => (e.source && e.target && e.sourceHandle && e.targetHandle)
                ? [{ from: { nodeId: e.source, portId: e.sourceHandle }, to: { nodeId: e.target, portId: e.targetHandle }, ...(typeof e.data?.['selector'] === 'string' ? { selector: e.data['selector'] } : {}) }]
                : [])
            )
          : null
        const top = preview ? singleTopLevelKey(preview) : null
        selector = top ?? '.'
        edgeStore.current.set(id, {
          id,
          from: { nodeId: src.id, portId: connection.sourceHandle },
          to: { nodeId: tgt.id, portId: connection.targetHandle },
          selector
        })
      } else if (isDataLink(inFlow, outFlow)) {
        const preview = staticScenarioPreview(
          { id: src.id, kind: src.data.kind, config: src.data.config ?? {} },
          nodes.map((x) => ({ id: x.id, kind: x.data.kind, config: x.data.config ?? {} })),
          edges.flatMap((e) => (e.source && e.target && e.sourceHandle && e.targetHandle)
            ? [{ from: { nodeId: e.source, portId: e.sourceHandle }, to: { nodeId: e.target, portId: e.targetHandle }, ...(typeof e.data?.['selector'] === 'string' ? { selector: e.data['selector'] } : {}) }]
            : [])
        )
        const path = preview ? singleDeepPath(preview) : null
        if (path) {
          selector = path
          // The selector lives authoritatively in `edgeStore` (persist rebuilds
          // each ScenarioEdge from it, not from the flow edge's `data`), so seed
          // it there too — otherwise the deduction is dropped on the next save.
          edgeStore.current.set(id, {
            id,
            from: { nodeId: src.id, portId: connection.sourceHandle },
            to: { nodeId: tgt.id, portId: connection.targetHandle },
            selector: path
          })
        }
      }
    }
    // When the link feeds an object-builder property whose name is still
    // empty, mirror the source's deduced single top-level key onto that
    // property's name — the user almost always wants the destination key to
    // mirror the source key (e.g. `now → object.prop` ⇒ `prop.name = "now"`).
    // Only fires for a bare identifier path (no dots / brackets); deeper
    // paths leave the name alone so the user picks deliberately.
    let propertyRename: { propertyId: string } | undefined
    if (tgt?.data.kind === 'object' && connection.targetHandle && selector && /^[A-Za-z_$][\w$]*$/.test(selector)) {
      const propsRaw = tgt.data.config?.['properties']
      const props = Array.isArray(propsRaw) ? (propsRaw as { id?: unknown; name?: unknown }[]) : []
      const prop = props.find((p) => p.id === connection.targetHandle)
      if (prop && (typeof prop.name !== 'string' || prop.name.trim() === '')) {
        propertyRename = { propertyId: connection.targetHandle }
      }
    }
    setEdges((curr) => {
      const next = addEdge({ ...connection, id, ...(stroke ? { style: { stroke } } : {}), ...(selector ? { data: { selector } } : {}) }, curr)
      setNodes((n) => {
        // Apply the property-name mirror first, so persist captures it.
        const rename = propertyRename
        const updated = rename && tgt && selector
          ? n.map((nd) => nd.id !== tgt.id ? nd : {
              ...nd,
              data: {
                ...nd.data,
                config: {
                  ...(nd.data.config ?? {}),
                  properties: Array.isArray(nd.data.config?.['properties'])
                    ? (nd.data.config['properties'] as { id?: unknown }[]).map((p) => p.id === rename.propertyId ? { ...(p as Record<string, unknown>), name: selector } : p)
                    : nd.data.config?.['properties']
                }
              }
            })
          : n
        persist(updated, next)
        return updated
      })
      return next
    })
  }, [setEdges, setNodes, persist, validateConnection, nodes, edges, derivedPortsOf])

  const addNode = useCallback((kind: ScenarioNodeKind, flow: { x: number; y: number }, config: Record<string, unknown> = {}) => {
    // A "Requête HTTP" node added from the palette (no bound request yet)
    // creates a fresh request as a child of this scenario and binds to it; a
    // drag from the tree already arrives with `requestId` set (bind existing).
    let nodeConfig = config
    if (kind === 'httpRequest' && config['requestId'] === undefined && onCreateRequest) {
      const newRequestId = onCreateRequest(scenario.id)
      if (newRequestId) nodeConfig = { ...config, requestId: newRequestId }
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { inputs, outputs } = defaultPortsForKind(kind)
    const node: ScenarioNode = { id, kind, config: nodeConfig, inputs, outputs, position: flow }
    nodeStore.current.set(id, node)
    setNodes((curr) => {
      const next = [...curr, toFlowNode(node, handlers.current)]
      setEdges((e) => { persist(next, e); return e })
      return next
    })
    setPalette(null)
  }, [setNodes, setEdges, persist, onCreateRequest, scenario.id])

  // Add-palette "Add" submenu: create a child item (request protocol /
  // sub-scenario) under this scenario AND drop its bound node. A request kind →
  // an `httpRequest` node bound by `requestId`; `scenario` → a `runScenario`
  // node bound by `scenarioId`. The child lands in the sidebar (silent).
  const addChildNode = useCallback((kind: AddChildKind, flow: { x: number; y: number }) => {
    const newId = onCreateChild?.(scenario.id, kind) ?? null
    if (!newId) { setPalette(null); return }
    if (kind === 'scenario') addNode('runScenario', flow, { scenarioId: newId })
    else addNode('httpRequest', flow, { requestId: newId })
  }, [onCreateChild, scenario.id, addNode])

  // --- Add-node gesture #1: drag a link off a port, release on empty canvas →
  // a palette filtered to kinds with a flow-compatible port, then a pre-wired
  // node. The dragged port's direction decides the wiring (output→new input,
  // or input←new output). ---
  const connectStart = useRef<{ nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null } | null>(null)
  // Releasing a connection drag on empty canvas fires `onConnectEnd` (which
  // opens the link palette) immediately followed by `onPaneClick` (~20ms) —
  // the same release counts as a pane click and would close the palette we
  // just opened. Record when we open it so `onPaneClick` can ignore that one.
  const linkPaletteOpenedAt = useRef(0)
  const [linkPalette, setLinkPalette] = useState<{
    x: number; y: number; flow: { x: number; y: number }
    fromNodeId: string; fromHandle: string; fromIsSource: boolean
    entries: { kind: ScenarioNodeKind; label: string; icon: string; wirePort: string }[]
  } | null>(null)

  const onConnectStart = useCallback<OnConnectStart>((_e, params) => {
    connectStart.current = { nodeId: params.nodeId ?? null, handleId: params.handleId ?? null, handleType: params.handleType ?? null }
  }, [])

  const onConnectEnd = useCallback<OnConnectEnd>((event, state) => {
    const start = connectStart.current
    connectStart.current = null
    // Only when released on empty canvas (a real drop on a handle sets toNode
    // and fires onConnect instead).
    if (state.toNode || !start?.nodeId || !start.handleId) return
    const srcNode = nodes.find((n) => n.id === start.nodeId)
    if (!srcNode) return
    const fromHandle = start.handleId
    const fromIsSource = start.handleType !== 'target'
    // Filtered, header-prioritising palette (see linkPaletteEntries); decorate
    // each with its catalogue label/icon. A runScenario's derived ports (incl.
    // the `done` trigger) join the static set so the dragged port's flow is
    // classified correctly.
    const srcDerived = derivedPortsOf(srcNode.data)
    const entries = linkPaletteEntries(
      {
        kind: srcNode.data.kind,
        inputs: srcDerived ? [...srcNode.data.inputs, ...srcDerived.inputs] : srcNode.data.inputs,
        outputs: srcDerived ? [...srcNode.data.outputs, ...srcDerived.outputs] : srcNode.data.outputs
      },
      fromHandle,
      fromIsSource
    ).map((e) => {
      const m = META_BY_KIND.get(e.kind)
      return { kind: e.kind, label: m ? t(m.labelKey, m.defaultLabel) : e.kind, icon: m?.icon ?? 'circle-outline', wirePort: e.wirePort }
    })
    if (entries.length === 0) return
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event
    const x = pt?.clientX ?? 0
    const y = pt?.clientY ?? 0
    linkPaletteOpenedAt.current = Date.now()
    setLinkPalette({ x, y, flow: screenToFlowPosition({ x, y }), fromNodeId: start.nodeId, fromHandle, fromIsSource, entries })
  }, [nodes, t, screenToFlowPosition, derivedPortsOf])

  // Create the picked kind at the drop point and wire it to the dragged port.
  // The id + node + edge are built ONCE, outside any state updater — React
  // StrictMode double-invokes updater functions in dev, so doing this inside
  // `setLinkPalette(updater)` minted two different ids and added the node twice.
  const addLinkedNode = useCallback((kind: ScenarioNodeKind, wirePort: string, config: Record<string, unknown> = {}) => {
    const lp = linkPalette
    if (!lp) return
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { inputs, outputs } = defaultPortsForKind(kind)
    const node: ScenarioNode = { id: newId, kind, config, inputs, outputs, position: lp.flow }
    nodeStore.current.set(newId, node)
    const edgeId = `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const edge: Edge = lp.fromIsSource
      ? { id: edgeId, source: lp.fromNodeId, sourceHandle: lp.fromHandle, target: newId, targetHandle: wirePort }
      : { id: edgeId, source: newId, sourceHandle: wirePort, target: lp.fromNodeId, targetHandle: lp.fromHandle }
    const srcN = nodeStore.current.get(edge.source)
    const srcPort = srcN?.outputs.find((o) => o.id === edge.sourceHandle)
      ?? derivedPortsOf(srcN)?.outputs.find((o) => o.id === edge.sourceHandle)
    const stroke = srcPort ? portColor(srcPort) : undefined
    if (stroke) edge.style = { stroke }
    setNodes((curr) => {
      const next = [...curr, toFlowNode(node, handlers.current)]
      setEdges((e) => { const ne = [...e, edge]; persist(next, ne); return ne })
      return next
    })
    setLinkPalette(null)
  }, [linkPalette, setNodes, setEdges, persist, derivedPortsOf])

  // Link-drag variant of {@link addChildNode}: create the child + drop its
  // bound node pre-wired to the dragged port. A freshly-created sub-scenario is
  // empty, so its only output is the `done` trigger — remap a `result` wire
  // target onto it.
  const addChildLinkedNode = useCallback((kind: AddChildKind, wirePort: string) => {
    const newId = onCreateChild?.(scenario.id, kind) ?? null
    if (!newId) { setLinkPalette(null); return }
    if (kind === 'scenario') addLinkedNode('runScenario', wirePort === 'result' ? 'done' : wirePort, { scenarioId: newId })
    else addLinkedNode('httpRequest', wirePort, { requestId: newId })
  }, [onCreateChild, scenario.id, addLinkedNode])

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
    if (isRequest(item)) { kind = 'httpRequest'; config = { requestId: item.id, label: item.name } }
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
    const clientX = 'clientX' in event ? event.clientX : 0
    const clientY = 'clientY' in event ? event.clientY : 0
    // Screen coords for the ContextMenu (same convention as the node menu).
    setPalette({ x: clientX, y: clientY, flow: screenToFlowPosition({ x: clientX, y: clientY }) })
  }, [screenToFlowPosition])

  // Right-click on an edge: select it (deselect the rest) + open the edge menu.
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault()
    event.stopPropagation()
    setEdges((curr) => curr.map((e) => (e.selected === (e.id === edge.id) ? e : { ...e, selected: e.id === edge.id })))
    setEdgeMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY })
  }, [setEdges])

  // Delete an edge (context-menu action; the Delete key is handled by React Flow).
  const deleteEdge = useCallback((edgeId: string) => {
    setEdgeMenu(null)
    setNodes((n) => {
      setEdges((e) => {
        const ne = e.filter((ed) => ed.id !== edgeId)
        edgeStore.current.delete(edgeId)
        persist(n, ne)
        return ne
      })
      return n
    })
  }, [setNodes, setEdges, persist])

  const openEdgeColorPicker = useCallback((edgeId: string, x: number, y: number) => {
    setEdgeMenu(null)
    setEdgeColorPicker({ edgeId, x, y })
  }, [])

  // Set (or, with `undefined`, reset to the role default) an edge's colour:
  // mutate the authoritative edge + repaint its stroke + persist.
  const setEdgeColor = useCallback((edgeId: string, color: string | undefined) => {
    const prior = edgeStore.current.get(edgeId)
    if (prior) {
      const updated: ScenarioEdge = { ...prior }
      if (color === undefined) delete updated.color
      else updated.color = color
      edgeStore.current.set(edgeId, updated)
    }
    setNodes((n) => {
      setEdges((curr) => {
        const next = curr.map((e) => {
          if (e.id !== edgeId) return e
          const sc = edgeStore.current.get(edgeId)
          const src = sc ? nodeStore.current.get(sc.from.nodeId) : undefined
          const port = sc
            ? (src?.outputs.find((o) => o.id === sc.from.portId) ?? derivedPortsOf(src)?.outputs.find((o) => o.id === sc.from.portId))
            : undefined
          const stroke = color ?? (port ? portColor(port) : undefined)
          return { ...e, style: { ...(e.style ?? {}), ...(stroke ? { stroke } : {}) } }
        })
        persist(n, next)
        return next
      })
      return n
    })
  }, [setNodes, setEdges, persist, derivedPortsOf])

  // A required input left unwired makes the scenario non-runnable.
  const invalidCount = useMemo(() => countUnsatisfiedRequired(nodes, edges, resolveScenario), [nodes, edges, resolveScenario])

  // Incoming data links (value/both output → data input) with their JSON-path
  // selector — feeds the empty/malformed-path validation rule. A runScenario's
  // outputs are derived, so merge them when classifying the source flow.
  const dataLinks = useMemo<ScenarioDataLink[]>(() => {
    const out: ScenarioDataLink[] = []
    for (const e of edges) {
      if (!e.source || !e.target || !e.sourceHandle || !e.targetHandle) continue
      const src = nodes.find((n) => n.id === e.source)
      const tgt = nodes.find((n) => n.id === e.target)
      if (!src || !tgt) continue
      // Object property inputs keep their own value field (no JSON-path
      // selector), so the empty/malformed-path rule doesn't apply to them.
      if (tgt.data.kind === 'object') continue
      const srcDerived = derivedPortsOf(src.data)?.outputs ?? []
      const outFlow = outputPortFlow([...src.data.outputs, ...srcDerived], e.sourceHandle, src.data.kind)
      const inFlow = inputPortFlow(tgt.data.inputs, e.targetHandle, tgt.data.kind)
      if (!isDataLink(inFlow, outFlow)) continue
      const selector = typeof e.data?.['selector'] === 'string' ? e.data['selector'] : undefined
      out.push({ targetNodeId: e.target, targetPort: e.targetHandle, selector })
    }
    return out
  }, [edges, nodes, derivedPortsOf])

  // Wired input ports (any incoming edge), keyed for the "input must be
  // connected" checks (e.g. an Output's `value`).
  const connectedTargets = useMemo(() => {
    const set = new Set<string>()
    for (const e of edges) if (e.target && e.targetHandle) set.add(targetKey(e.target, e.targetHandle))
    return set
  }, [edges])

  // Per-box validation errors (missing name, bad data-link path, …) keyed by
  // node id — drives the red border + disabled play (via ScenarioErrorsContext)
  // and the workflow error panel below. The pure validator covers config-only
  // rules; a second pass adds the resolver-dependent ones (a bound request /
  // scenario that's unset or deleted, and a runScenario's required sub-scenario
  // inputs left unwired) which need the tree, not just the node config.
  const nodeErrors = useMemo(() => {
    const byNode = validateScenarioGraph(nodes.map((n) => ({ id: n.id, kind: n.data.kind, config: n.data.config ?? {} })), dataLinks, connectedTargets, t)
    const add = (id: string, error: ScenarioNodeError): void => {
      const list = byNode.get(id)
      if (list) list.push(error)
      else byNode.set(id, [error])
    }
    for (const n of nodes) {
      // A request / runScenario box is always created bound (palette or drag),
      // so an *unbound* box can't occur — only a *deleted* binding can, which
      // we flag as a safety net (incoherent state from an external delete).
      if (n.data.kind === 'httpRequest') {
        const requestId = typeof n.data.config?.['requestId'] === 'string' ? n.data.config['requestId'] : ''
        if (requestId) {
          const item = resolveBoundItem?.(requestId) ?? null
          if (!item || !isRequest(item)) add(n.id, { code: 'request-missing', message: t('scenario.validation.request.missing', 'The bound request no longer exists.') })
        }
      } else if (n.data.kind === 'runScenario') {
        const scenarioId = typeof n.data.config?.['scenarioId'] === 'string' ? n.data.config['scenarioId'] : ''
        if (scenarioId) {
          const sub = resolveScenario(scenarioId)
          if (!sub) {
            add(n.id, { code: 'scenario-missing', message: t('scenario.validation.runScenario.missing', 'The bound scenario no longer exists.') })
          } else {
            for (const port of deriveRunScenarioPorts(sub).inputs) {
              if (port.required && !connectedTargets.has(targetKey(n.id, port.id))) {
                add(n.id, { code: 'required-input', field: port.id, message: t('scenario.validation.runScenario.requiredInput', 'The required input "{{name}}" must be wired to a source.', { name: port.name }) })
              }
            }
          }
        }
      }
    }
    return byNode
  }, [nodes, dataLinks, connectedTargets, resolveBoundItem, resolveScenario, t])
  // Flat list of every box error, with the box's display title, for the panel.
  const workflowErrors = useMemo<{ nodeId: string; title: string; error: ScenarioNodeError }[]>(() => {
    const meta = new Map(nodes.map((n) => [n.id, t(scenarioNodeMeta(n.data.kind).labelKey, scenarioNodeMeta(n.data.kind).defaultLabel)]))
    const out: { nodeId: string; title: string; error: ScenarioNodeError }[] = []
    for (const [nodeId, errs] of nodeErrors) {
      for (const error of errs) out.push({ nodeId, title: meta.get(nodeId) ?? nodeId, error })
    }
    return out
  }, [nodeErrors, nodes, t])

  // The single selected box, previewed in the inspector panel (name, note, and
  // each output's value). Null when zero or several boxes are selected.
  const previewNode = useMemo<InspectorPreviewNode | null>(() => {
    const selected = nodes.filter((n) => n.selected)
    if (selected.length !== 1) return null
    const n = selected[0]
    if (!n) return null
    const cfg = n.data.config ?? {}
    const meta = scenarioNodeMeta(n.data.kind)
    // Default: mirror the box header — kind icon (codicon) + kind label. For
    // runScenario / httpRequest, swap in the bound item's real name and its
    // semantic badge (SCENARIO icon / HTTP method) so the inspector shows the
    // exact same identity the user sees on the box header.
    let title = t(meta.labelKey, meta.defaultLabel)
    let titleBadge: React.ReactNode = <i className={`codicon codicon-${meta.icon}`} aria-hidden="true" />
    if (n.data.kind === 'runScenario') {
      const boundId = typeof cfg['scenarioId'] === 'string' ? cfg['scenarioId'] : null
      const boundItem = boundId ? (resolveBoundItem?.(boundId) ?? null) : null
      if (boundItem && isScenario(boundItem)) {
        title = boundItem.name
        titleBadge = <Badge type="SCENARIO" />
      }
    } else if (n.data.kind === 'httpRequest') {
      const boundId = typeof cfg['requestId'] === 'string' ? cfg['requestId'] : null
      const boundItem = boundId ? (resolveBoundItem?.(boundId) ?? null) : null
      if (boundItem && isRequest(boundItem)) {
        title = boundItem.name
        titleBadge = <Badge type={requestBadgeType(boundItem)} />
      }
    }
    const outputs = [...n.data.outputs, ...(derivedPortsOf(n.data)?.outputs ?? [])]
    // Config-derived preview for static kinds (input, object, …) — shown
    // without a run. Computed from the live node configs + links across the
    // graph (an object property wired to a non-static source is omitted).
    const staticEdges = edges.flatMap((e) => {
      if (!e.source || !e.target || !e.sourceHandle || !e.targetHandle) return []
      const sel = typeof e.data?.['selector'] === 'string' ? e.data['selector'] : undefined
      return [{ from: { nodeId: e.source, portId: e.sourceHandle }, to: { nodeId: e.target, portId: e.targetHandle }, ...(sel !== undefined ? { selector: sel } : {}) }]
    })
    // `runScenario` lives across scenarios — its outputs are the sub-scenario's
    // named Output nodes resolved statically. The shared static-preview can't
    // see across scenarios, so the editor branches it through a dedicated
    // context API method.
    const staticData = n.data.kind === 'runScenario'
      ? staticPreviewApi.getRunScenarioOutputs(n.id)
      : staticScenarioPreview(
          { id: n.id, kind: n.data.kind, config: cfg },
          nodes.map((x) => ({ id: x.id, kind: x.data.kind, config: x.data.config ?? {} })),
          staticEdges
        )
    // For an object / wait / waitUntil, also surface the wired non-static
    // properties so the inspector can fetch + inject (cf. wiredFetches).
    const wiredFetches = staticPreviewApi.getObjectWiredProperties(n.id)
    // For a list-op box (map / filter / aggregate) whose `items` come from a
    // non-static source, hand the inspector a recipe: where to fetch the
    // items + how to apply the box's operation once they're resolved.
    let listOp: InspectorPreviewNode['listOp']
    if (n.data.kind === 'map' || n.data.kind === 'filter' || n.data.kind === 'aggregate' || n.data.kind === 'forEach') {
      const itemsEdge = edges.find((e) => e.target === n.id && e.targetHandle === 'items')
      if (itemsEdge?.source) {
        const sourceNode = nodes.find((x) => x.id === itemsEdge.source)
        if (sourceNode && !STATIC_PREVIEW_KINDS.has(sourceNode.data.kind)) {
          const sel = typeof itemsEdge.data?.['selector'] === 'string' ? itemsEdge.data['selector'] : undefined
          const nodeKind = n.data.kind
          listOp = {
            fetch: { sourceNodeId: sourceNode.id, ...(sel !== undefined ? { selector: sel } : {}) },
            apply: (items) => applyListOp({ id: n.id, kind: nodeKind, config: cfg }, items)
          }
        }
      }
    }
    return {
      id: n.id,
      title,
      titleBadge,
      ...(n.data.note ? { note: n.data.note } : {}),
      outputs,
      staticData,
      ...(wiredFetches.length > 0 ? { wiredFetches } : {}),
      ...(listOp ? { listOp } : {})
    }
  }, [nodes, edges, t, derivedPortsOf, staticPreviewApi, resolveBoundItem])

  // Wire-ports for the link-drag "Add" submenu — the port the link filter
  // computed for the (folded) request / sub-scenario kinds, when each is
  // flow-compatible with the dragged port. `const` so the `!== undefined`
  // narrowing flows into the menu `onClick` closures below.
  const linkReqWire = linkPalette?.entries.find((e) => e.kind === 'httpRequest')?.wirePort
  const linkScnWire = linkPalette?.entries.find((e) => e.kind === 'runScenario')?.wirePort

  // Variables in scope — declared by `setVariable` nodes and named `input`/param
  // nodes, each carrying the type it was declared with. Drives the value
  // selector's "Variables" menu (and lets a slot hide incompatible-typed ones).
  const scenarioVariables = useMemo<ScenarioVariable[]>(() => {
    const byName = new Map<string, ScenarioVariable>()
    for (const node of nodes) {
      const kind = node.data.kind
      if (kind !== 'setVariable' && kind !== 'input') continue
      const config = node.data.config as { name?: unknown; value?: unknown; valueType?: unknown } | undefined
      const name = config?.name
      if (typeof name !== 'string' || name.trim() === '') continue
      // setVariable stores the value under `value`; the input/param node under
      // `valueType`. The declared type is that value's kind.
      const rawValue = kind === 'setVariable' ? config?.value : config?.valueType
      const type = resolveValueTypeKind(normalizeValueType(rawValue))
      byName.set(name, { name, type })
    }
    return [...byName.values()]
  }, [nodes])

  return (
    <ScenarioBoundResolverContext.Provider value={resolveBoundItem ?? null}>
    <ScenarioRequestEnvContext.Provider value={resolveRequestEnv ?? null}>
    <ScenarioVariablesContext.Provider value={scenarioVariables}>
    <ScenarioEdgeSelectorContext.Provider value={edgeSelectorApi}>
    <ScenarioStaticPreviewContext.Provider value={staticPreviewApi}>
    <ScenarioErrorsContext.Provider value={nodeErrors}>
    <div ref={wrapperRef} data-testid="scenario-editor" style={containerStyle} onDragOver={onDragOver} onDrop={onDrop}>
      {nodes.length === 0 && (
        <div data-testid="scenario-editor-empty" style={emptyStyle}>
          {t('scenario.editor.empty', 'Empty scenario — right-click the canvas to add a node')}
        </div>
      )}
      {invalidCount > 0 && (
        <div data-testid="scenario-invalid-banner" style={invalidBannerStyle}>
          <i className="codicon codicon-warning" aria-hidden="true" />
          {t('scenario.invalid', { count: invalidCount, defaultValue: '{{count}} required input(s) not wired — scenario is not runnable' })}
        </div>
      )}
      <ScenarioInspectorPanel
        scenarioId={scenario.id}
        errors={workflowErrors}
        errorBoxCount={nodeErrors.size}
        onFocusNode={(nodeId) => { void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2 }) }}
        previewNode={previewNode}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={validateConnection}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Control', 'Meta']}
        onPaneContextMenu={onPaneContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => {
          setPalette(null); setNodeMenu(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null)
          if (Date.now() - linkPaletteOpenedAt.current > 250) setLinkPalette(null)
          dismissOffCanvasPopovers()
        }}
        onNodeClick={() => { setNodeMenu(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null); setLinkPalette(null); dismissOffCanvasPopovers() }}
        onEdgeClick={() => { setNodeMenu(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null); setLinkPalette(null); dismissOffCanvasPopovers() }}
        onMoveStart={() => { setNodeMenu(null); setPalette(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null); setLinkPalette(null) }}
        onNodeDragStart={() => { setNodeMenu(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null); setLinkPalette(null) }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        {/* Unique pattern id per scenario: React Flow's Background derives its
            SVG <pattern> id from this, and with several scenario tabs mounted
            at once a shared id makes `url(#pattern-…)` resolve to the first
            (often a hidden 0×0 tab), leaving the visible grid blank. */}
        <Background id={scenario.id} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {palette && (
        <ContextMenu
          visible
          x={palette.x}
          y={palette.y}
          onRequestClose={() => { setPalette(null) }}
          data-testid="scenario-node-palette"
          items={PALETTE_ENTRIES.flatMap((e, i): ContextMenuItem[] =>
            // Fold the request + run-scenario entries into a single "Add"
            // submenu (child request of any protocol / sub-scenario, created in
            // the sidebar + dropped on the graph). Without `onCreateChild`, keep
            // the two bare entries.
            'separator' in e
              ? [{ id: `sep-${i}`, label: '', isSeparator: true }]
              : onCreateChild && e.kind === 'runScenario'
                ? []
                : onCreateChild && e.kind === 'httpRequest'
                  ? [{
                      id: 'scenario-add',
                      label: t('sidebar.contextMenu.add.title', 'Add'),
                      icon: 'add',
                      items: [
                        ...SCENARIO_ADD_REQUEST_GROUPS.flatMap((group, gi): ContextMenuItem[] => [
                          ...(gi > 0 ? [{ id: `add-rsep-${gi}`, label: '', isSeparator: true } as ContextMenuItem] : []),
                          ...group.map((c): ContextMenuItem => ({ id: `add-${c.kind}`, label: t(c.labelKey, c.defaultLabel), icon: scenarioAddIcon(c.badge), onClick: () => { addChildNode(c.kind, palette.flow) } }))
                        ]),
                        { id: 'add-scn-sep', label: '', isSeparator: true },
                        { id: `add-${SCENARIO_ADD_SCENARIO_ENTRY.kind}`, label: t(SCENARIO_ADD_SCENARIO_ENTRY.labelKey, SCENARIO_ADD_SCENARIO_ENTRY.defaultLabel), icon: scenarioAddIcon(SCENARIO_ADD_SCENARIO_ENTRY.badge), onClick: () => { addChildNode('scenario', palette.flow) } }
                      ]
                    }]
                  : [{ id: e.kind, label: t(e.labelKey, e.defaultLabel), icon: e.icon, onClick: () => { addNode(e.kind, palette.flow) } }]
          )}
        />
      )}
      {linkPalette && (
        <ContextMenu
          visible
          x={linkPalette.x}
          y={linkPalette.y}
          onRequestClose={() => { setLinkPalette(null) }}
          data-testid="scenario-link-palette"
          items={
            // Fold the flow-compatible request / run-scenario entries into one
            // "Add" submenu, wired through the port the filter computed (a fresh
            // sub-scenario only has its `done` trigger, so the helper remaps
            // `result`). Without `onCreateChild`, entries stay flat.
            !onCreateChild
              ? linkPalette.entries.map((e): ContextMenuItem => ({ id: e.kind, label: e.label, icon: e.icon, onClick: () => { addLinkedNode(e.kind, e.wirePort) } }))
              : [
                  ...(linkReqWire !== undefined || linkScnWire !== undefined
                    ? [{
                        id: 'scenario-add',
                        label: t('sidebar.contextMenu.add.title', 'Add'),
                        icon: 'add',
                        items: [
                          ...(linkReqWire !== undefined
                            ? SCENARIO_ADD_REQUEST_GROUPS.flatMap((group, gi): ContextMenuItem[] => [
                                ...(gi > 0 ? [{ id: `add-rsep-${gi}`, label: '', isSeparator: true } as ContextMenuItem] : []),
                                ...group.map((c): ContextMenuItem => ({ id: `add-${c.kind}`, label: t(c.labelKey, c.defaultLabel), icon: scenarioAddIcon(c.badge), onClick: () => { addChildLinkedNode(c.kind, linkReqWire) } }))
                              ])
                            : []),
                          ...(linkScnWire !== undefined
                            ? [
                                ...(linkReqWire !== undefined ? [{ id: 'add-scn-sep', label: '', isSeparator: true } as ContextMenuItem] : []),
                                { id: `add-${SCENARIO_ADD_SCENARIO_ENTRY.kind}`, label: t(SCENARIO_ADD_SCENARIO_ENTRY.labelKey, SCENARIO_ADD_SCENARIO_ENTRY.defaultLabel), icon: scenarioAddIcon(SCENARIO_ADD_SCENARIO_ENTRY.badge), onClick: () => { addChildLinkedNode('scenario', linkScnWire) } } as ContextMenuItem
                              ]
                            : [])
                        ]
                      } as ContextMenuItem]
                    : []),
                  ...linkPalette.entries
                    .filter((e) => e.kind !== 'httpRequest' && e.kind !== 'runScenario')
                    .map((e): ContextMenuItem => ({ id: e.kind, label: e.label, icon: e.icon, onClick: () => { addLinkedNode(e.kind, e.wirePort) } }))
                ]
          }
        />
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
      {edgeMenu && (
        <ContextMenu
          visible
          x={edgeMenu.x}
          y={edgeMenu.y}
          onRequestClose={() => { setEdgeMenu(null) }}
          data-testid="scenario-edge-menu"
          items={[
            { id: 'edge-color', label: t('scenario.edge.menu.changeColor', 'Change colour'), icon: 'symbol-color', opensDialog: true, onClick: () => { openEdgeColorPicker(edgeMenu.edgeId, edgeMenu.x, edgeMenu.y) } },
            { id: 'edge-sep', label: '', isSeparator: true },
            { id: 'edge-delete', label: t('scenario.edge.menu.delete', 'Delete'), icon: 'trash', shortcut: t('scenario.node.menu.deleteShortcut', 'Del'), onClick: () => { deleteEdge(edgeMenu.edgeId) } }
          ]}
        />
      )}
      {edgeColorPicker && (
        <div ref={edgeColorAnchorRef} style={{ position: 'fixed', left: edgeColorPicker.x, top: edgeColorPicker.y, width: 0, height: 0, pointerEvents: 'none' }} />
      )}
      <Tooltip
        targetRef={edgeColorAnchorRef}
        show={edgeColorPicker !== null}
        repositionKey={edgeColorPicker?.edgeId ?? null}
        data-testid="scenario-edge-color-picker-tooltip"
        placement="below"
        side="auto"
        content={
          <div onMouseDown={(e) => { e.stopPropagation() }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ColorPicker
              value={(() => { const s = edgeColorPicker ? edges.find((e) => e.id === edgeColorPicker.edgeId)?.style?.stroke : undefined; return typeof s === 'string' ? s : '#3b82f6' })()}
              onChange={(color) => { if (edgeColorPicker) setEdgeColor(edgeColorPicker.edgeId, color) }}
              disableAlpha
              data-testid="scenario-edge-color-picker"
            />
            <Button
              secondary
              fullWidth
              icon="trash"
              onClick={() => { if (edgeColorPicker) { setEdgeColor(edgeColorPicker.edgeId, undefined); setEdgeColorPicker(null) } }}
              options={{ ariaLabel: t('scenario.edge.menu.resetColor', 'Reset colour'), title: t('scenario.edge.menu.resetColor', 'Reset colour') }}
              data-testid="scenario-edge-color-reset"
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
    </ScenarioErrorsContext.Provider>
    </ScenarioStaticPreviewContext.Provider>
    </ScenarioEdgeSelectorContext.Provider>
    </ScenarioVariablesContext.Provider>
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
