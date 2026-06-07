import React, { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useUpdateNodeInternals,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type OnConnectStart,
  type OnConnectEnd,
  type Viewport
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { Button, ContextMenu, Tooltip, ColorPicker, Modal, MarkdownEditor, eventBus, isUndoKeyEvent, isRedoKeyEvent, type ContextMenuItem } from 'electron-core-ui/renderer'
import type { Scenario, ScenarioNode, ScenarioEdge, ScenarioNodeKind, ScenarioPort } from '../../../../shared/types/collections'
import { isRequest, isScenario } from '../../../../shared/types/collections'
import { Badge } from '../common/Badge'
import { requestBadgeType } from '../../utils/badgeUtils'
import { ScenarioBoundResolverContext, ScenarioRequestEnvContext, type ResolveBoundItem, type ResolveRequestEnv } from './scenarioBoundResolver'
import type { SyntheticRequestPreview } from '../../../../shared/utils/syntheticRequestPreview'
import { ScenarioEdgeSelectorContext, type ScenarioEdgeSelectorApi } from './scenarioEdgeSelector'
import { ScenarioStaticPreviewContext, type ScenarioStaticPreviewApi, type ObjectWiredProperty } from './scenarioStaticPreviewContext'
import { ScenarioVariablesContext, type ScenarioVariable } from '../../contexts/ScenarioVariablesContext'
import { getScenarioViewport, setScenarioViewport } from '../../services/scenarioViewportStore'
import { getScenarioBreakpoints, toggleBreakpoint, pruneScenarioBreakpoints } from '../../services/scenarioBreakpointStore'
import { WorkbenchActiveTabContext } from '../../contexts/WorkbenchActiveTabContext'
import { resolveValueTypeKind } from '../TypedValueField/castValue'
import { normalizeValueType } from '../../utils/normalizeValueType'
import { SCENARIO_NODE_CATALOGUE, SCENARIO_SUBMENU_CATEGORIES, scenarioNodeMeta, type ScenarioNodeKindMeta, type ScenarioNodeCategory } from './scenarioNodeCatalogue'
import { scenarioEdgeToFlowEdge, flowEdgeToScenarioEdge, edgeColorForHandle } from './scenarioGraphMapping'
import { ScenarioNodeView, type ScenarioNodeBoxData } from './nodes'
import { setScenarioClipboard, getScenarioClipboard, hasScenarioClipboard, nextPasteDelta } from './scenarioActionClipboard'
import { defaultPortsForKind, isValidScenarioConnection, deriveRunScenarioPorts, inputPortFlow, outputPortFlow } from './scenarioNodePorts'
import { isDataLink } from './scenarioPathTree'
import { linkPaletteEntries } from './scenarioLinkPalette'
// Side-effect: registers the env → { name, variables } resolver used by the
// inspector's static preview (mirrors the runtime's env resolution).
import './scenarioEnvPreview'
import { SCENARIO_ADD_REQUEST_GROUPS, SCENARIO_ADD_SCENARIO_ENTRY, scenarioAddIcon } from './scenarioChildPalette'
import type { AddChildKind } from '../MainView/Sidebar/contextMenuBuilder'
import type { TFunction } from 'i18next'
import { ScenarioGraphPreview } from '../MainView/Titlebar/ScenarioGraphPreview'
import { validateScenarioGraph, targetKey, type ScenarioNodeError, type ScenarioDataLink, type ValidationNode } from '../../../../shared/scenarioValidation'
import { readInputParams } from '../../../../shared/scenarioInputParams'
import { ScenarioErrorsContext } from './scenarioErrorsContext'
import { ScenarioInternalsContext } from './scenarioInternalsContext'
import { ScenarioInspectorPanel, type InspectorPreviewNode } from './ScenarioInspectorPanel'
import { useScenarioEngine } from '../../hooks/useScenarioEngine'
import { ScenarioInputPrompt } from './ScenarioInputPrompt'
import { ScenarioRunHistoryModal } from './ScenarioRunHistoryModal'
import { SCENARIO_RUN_HISTORY_OPEN, type ScenarioRunHistoryOpenPayload } from './scenarioRunHistoryEvents'
import { ScenarioDebugBezierEdge } from './ScenarioDebugBezierEdge'
import { staticScenarioPreview, singleDeepPath, expectsObjectInput, singleTopLevelKey, portPreviewValue, STATIC_PREVIEW_KINDS, resolveItems, applyListOp, type StaticPreviewNode, type StaticPreviewEdge } from '../../../../shared/utils/scenarioStaticPreview'
import { consumePendingScenarioNodeFocus, onScenarioNodeFocus, clearPendingScenarioNodeFocus } from '../../services/scenarioFocusBus'
import { dynamicHandleIds, pruneOrphanDynamicEdges, isOrphanDynamicEdge } from './orphanEdgeSanitizer'

export interface ScenarioEditorViewProps {
  /** The scenario being edited. */
  scenario: Scenario
  /** This editor's workbench tab id — compared against the active-tab context
   * so keyboard shortcuts + the Delete key only fire on the focused tab (never
   * a background split). */
  tabId?: string
  /** Workspace identity (user-scope key) for persisting graph pan+zoom.
   * Passed from the workbench — the editor renders outside the
   * EnvironmentProvider, so it can't read the env context. */
  projectUuid?: string | null | undefined
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
  /** Build a synthetic preview from a request's imported documentation.
   * The inspector uses it when a request box has no recent run result
   * but its env folder carries a spec — same `{request, response}`
   * shape as a real run, with sample values keyed by the spec. */
  resolveSyntheticPreview?: (requestId: string) => SyntheticRequestPreview | null
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
// Every persisted scenario edge defaults to the bezier shape — overriding
// the React Flow built-in lets us overlay the debug travelling-beam SMIL
// element on top of the same bezier path.
const edgeTypes = { default: ScenarioDebugBezierEdge }

const containerStyle: CSSProperties = { width: '100%', height: '100%', position: 'relative' }

// React Flow syncs these props into its internal store; passing a fresh
// array/object literal on every editor render (which happens on EVERY drag
// tick, via `setNodes`) churns the store and cascades a re-render into every
// node — turning one box move into "re-render all boxes" each pointer move.
// Hoisting the stable values to module scope keeps their identity constant.
const PAN_ON_DRAG = [1]
const MULTI_SELECTION_KEYS = ['Control', 'Meta']
const DELETE_KEYS = ['Delete', 'Backspace']
const PRO_OPTIONS = { hideAttribution: true }
// Grid pitch shared by the dotted Background and snap-to-grid, so dropped /
// dragged boxes land on the visible dots. Matches React Flow's default gap.
const GRID_SIZE = 20
const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE]

// Static-preview helpers as pure module functions taking explicit nodes/edges,
// so they can be called both during render (inspector preview, with the live
// `nodes` / `edges`) AND from the stable `ScenarioStaticPreviewContext` API
// (with the post-commit refs) — without the context object closing over the
// live arrays (which would rebuild it, and re-render every box, each drag tick).
function collectObjectWiredProps(target: Node<ScenarioNodeBoxData>, nodes: Node<ScenarioNodeBoxData>[], edges: Edge[]): ObjectWiredProperty[] {
  const out: ObjectWiredProperty[] = []
  const collect = (previewKey: string, portId: string): void => {
    const edge = edges.find((e) => e.target === target.id && e.targetHandle === portId)
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
}

/** Rewrite an `input` node's config so each param's typed default is replaced
 * by the matching value entered in the parent `runScenario` (keyed by param
 * name). Params with no matching entry (e.g. predecessor-fed inputs) keep their
 * own default. Writing `config.params` covers the legacy single-param shape too
 * — `readInputParams` reads `params` first. */
function applyParamValuesToInputConfig(config: Record<string, unknown>, paramValues: Record<string, unknown>): Record<string, unknown> {
  const params = readInputParams(config)
  if (params.length === 0 || !params.some((p) => paramValues[p.name] !== undefined)) return config
  const nextParams = params.map((p) => {
    const override = paramValues[p.name]
    return override === undefined ? p : { ...p, valueType: override }
  })
  return { ...config, params: nextParams }
}

function computeRunScenarioOutputs(runNode: Node<ScenarioNodeBoxData>, resolveBoundItem: ResolveBoundItem | null | undefined): Record<string, unknown> | null {
  if (runNode.data.kind !== 'runScenario') return null
  const runCfg = runNode.data.config ?? {}
  const subId = typeof runCfg['scenarioId'] === 'string' ? runCfg['scenarioId'] : null
  if (!subId) return null
  const subItem = resolveBoundItem?.(subId) ?? null
  const sub = subItem && isScenario(subItem) ? subItem : null
  if (!sub) return null
  // The values entered in the runScenario's parameters (keyed by param name)
  // override each matching sub-scenario `input` node's typed default, so the
  // output preview reflects what the parent passes in — not the sub-scenario's
  // own defaults. Predecessor-fed params carry no entry and keep their default.
  // This is a STATIC approximation: the override is read through `concreteValue`,
  // whereas the runtime resolves the same typed value through `resolveOperand`.
  // They agree for scalars; an `environment` operand differs (preview shows the
  // resolver shape / null, runtime the live `{name,variables}`) — acceptable for
  // a pre-run hint.
  const paramValuesRaw = runCfg['paramValues']
  const paramValues = paramValuesRaw && typeof paramValuesRaw === 'object' && !Array.isArray(paramValuesRaw)
    ? (paramValuesRaw as Record<string, unknown>)
    : null
  const subNodes: StaticPreviewNode[] = sub.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    config: paramValues && n.kind === 'input' ? applyParamValuesToInputConfig(n.config, paramValues) : n.config
  }))
  const subEdges: StaticPreviewEdge[] = sub.edges.map((e) => ({ from: e.from, to: e.to, ...(e.selector !== undefined ? { selector: e.selector } : {}) }))
  // Each `output` node's static preview resolves every decl — wired sources
  // (selector applied) AND literal fallbacks on unwired decls — keyed by output
  // name, the same shape `runSubScenario` returns. Reusing it (over a manual
  // edge walk) keeps the unwired-literal path in sync with the inspector.
  const out: Record<string, unknown> = {}
  for (const node of subNodes) {
    if (node.kind !== 'output') continue
    const sp = staticScenarioPreview(node, subNodes, subEdges)
    if (sp) Object.assign(out, sp)
  }
  return out
}
const emptyStyle: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  pointerEvents: 'none', opacity: 0.6, fontSize: 13, zIndex: 1
}
/** Banner shown while a run is in flight — the graph is read-only until it
 * finishes (no drag / connect / delete / config edits / add-node). */
const lockedBannerStyle: CSSProperties = {
  position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
  display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none',
  padding: '4px 10px', borderRadius: 4, fontSize: 12,
  background: 'var(--inputValidation-infoBackground, #063b49)',
  color: 'var(--inputValidation-infoForeground, #fff)',
  border: '1px solid var(--inputValidation-infoBorder, #1a85ff)'
}
/** The catalogue flattened with a separator marker between categories — the
 * add-node menu maps this to ContextMenu items. Computed once (no refs / no
 * render-phase work). */
const PALETTE_ENTRIES: (ScenarioNodeKindMeta | { separator: true })[] = SCENARIO_NODE_CATALOGUE.flatMap(
  (meta, i, arr) => (i > 0 && arr[i - 1]?.category !== meta.category ? [{ separator: true as const }, meta] : [meta])
)

/** Kinds in a catalogue category, in order — submenu categories fold theirs into
 * one nested menu (keyed off the category so a new kind joins automatically). */
const metasInCategory = (category: ScenarioNodeCategory): ScenarioNodeKindMeta[] =>
  SCENARIO_NODE_CATALOGUE.filter((m) => m.category === category)

interface PaletteBuildParams {
  t: TFunction
  /** True when child request/sub-scenario creation is available. */
  withAddSubmenu: boolean
  /** onClick for a plain node kind, or null to omit it (link palette filter). */
  pickNode: (kind: ScenarioNodeKind) => (() => void) | null
  /** onClick for a child request-protocol / sub-scenario kind, or null to omit. */
  pickChild: (kind: string) => (() => void) | null
}

/** Drop orphan separators (leading, trailing, consecutive) left after filtering. */
function tidyPaletteSeparators(items: ContextMenuItem[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = []
  for (const it of items) {
    if (it.isSeparator && (out.length === 0 || out[out.length - 1]?.isSeparator)) continue
    out.push(it)
  }
  while (out.length > 0 && out[out.length - 1]?.isSeparator) out.pop()
  return out
}

/**
 * Build the add-node ContextMenu items in the CANONICAL catalogue order, shared
 * by the canvas palette AND the link-drop palette so both read identically —
 * request/sub-scenario folded into one "Add" submenu at the httpRequest slot,
 * the loop kinds into one "Loops" submenu. Unavailable kinds (pick* → null) are
 * dropped, then the category separators are tidied.
 */
function buildScenarioPaletteItems(p: PaletteBuildParams): ContextMenuItem[] {
  const sep = (id: string): ContextMenuItem => ({ id, label: '', isSeparator: true })
  const items = PALETTE_ENTRIES.flatMap((e, i): ContextMenuItem[] => {
    if ('separator' in e) return [sep(`sep-${i}`)]
    if (p.withAddSubmenu && e.kind === 'runScenario') return [] // folds into "Add"
    if (p.withAddSubmenu && e.kind === 'httpRequest') {
      const reqItems = SCENARIO_ADD_REQUEST_GROUPS.flatMap((group, gi): ContextMenuItem[] => {
        const picked = group.flatMap((c): ContextMenuItem[] => {
          const cb = p.pickChild(c.kind)
          return cb ? [{ id: `add-${c.kind}`, label: p.t(c.labelKey, c.defaultLabel), icon: scenarioAddIcon(c.badge), onClick: cb }] : []
        })
        return picked.length > 0 ? [...(gi > 0 ? [sep(`add-rsep-${gi}`)] : []), ...picked] : []
      })
      const scnCb = p.pickChild(SCENARIO_ADD_SCENARIO_ENTRY.kind)
      const scnItems: ContextMenuItem[] = scnCb
        ? [...(reqItems.length > 0 ? [sep('add-scn-sep')] : []), { id: `add-${SCENARIO_ADD_SCENARIO_ENTRY.kind}`, label: p.t(SCENARIO_ADD_SCENARIO_ENTRY.labelKey, SCENARIO_ADD_SCENARIO_ENTRY.defaultLabel), icon: scenarioAddIcon(SCENARIO_ADD_SCENARIO_ENTRY.badge), onClick: scnCb }]
        : []
      const sub = [...reqItems, ...scnItems]
      return sub.length > 0 ? [{ id: 'scenario-add', label: p.t('sidebar.contextMenu.add.title', 'Add'), icon: 'add', items: sub }] : []
    }
    const submenu = SCENARIO_SUBMENU_CATEGORIES[e.category]
    if (submenu) {
      const groupMetas = metasInCategory(e.category)
      if (e.kind !== groupMetas[0]?.kind) return [] // emitted once, at the category's first kind
      const subItems = groupMetas.flatMap((m): ContextMenuItem[] => {
        const cb = p.pickNode(m.kind)
        return cb ? [{ id: `submenu-${m.kind}`, label: p.t(m.labelKey, m.defaultLabel), icon: m.icon, onClick: cb }] : []
      })
      return subItems.length > 0 ? [{ id: `scenario-group-${e.category}`, label: p.t(submenu.labelKey, submenu.defaultLabel), icon: submenu.icon, items: subItems }] : []
    }
    const cb = p.pickNode(e.kind)
    return cb ? [{ id: e.kind, label: p.t(e.labelKey, e.defaultLabel), icon: e.icon, onClick: cb }] : []
  })
  return tidyPaletteSeparators(items)
}

interface NodeHandlers {
  scenarioId: string
  onToggleCollapse: (id: string) => void
  onHeaderContextMenu: (id: string, x: number, y: number) => void
  onSetConfig: (id: string, config: Record<string, unknown>) => void
  onToggleBreakpoint: (id: string) => void
  onOpenItem?: (itemId: string) => void
}

/** One undo/redo step: a full copy of the scenario graph. */
interface ScenarioSnapshot {
  nodes: ScenarioNode[]
  edges: ScenarioEdge[]
}

/** Build a `ScenarioNode` in one fixed field order. Used by BOTH `persist` and
 * the undo/redo baseline so an unchanged graph serializes identically — the
 * history dedup compares JSON, so byte-identical output is what keeps a no-op
 * persist (e.g. the one React Flow fires on load) from recording a phantom
 * undo step. */
function canonicalScenarioNode(p: {
  id: string
  kind: ScenarioNode['kind']
  config: Record<string, unknown>
  inputs: ScenarioNode['inputs']
  outputs: ScenarioNode['outputs']
  position: ScenarioNode['position']
  note?: string
  color?: string
  collapsed?: boolean
}): ScenarioNode {
  return {
    id: p.id,
    kind: p.kind,
    config: p.config,
    inputs: p.inputs,
    outputs: p.outputs,
    position: p.position,
    ...(p.note !== undefined ? { note: p.note } : {}),
    ...(p.color !== undefined ? { color: p.color } : {}),
    ...(p.collapsed !== undefined ? { collapsed: p.collapsed } : {})
  }
}

/** Drop the obsolete single-param fields (`config.name` / `config.valueType`)
 * from an input node that already carries a `params` array. They're a leftover
 * of the single→multi-param migration: `readInputParams` reads `params` and
 * ignores them, so they're inert — but they linger in the persisted file and
 * mislead anything still glancing at `config.name`. Non-input nodes and
 * pure-legacy inputs (no `params` yet — e.g. an MCP-created one) are untouched,
 * since for those `config.name` IS the live declaration. */
function stripLegacyInputFields(node: ScenarioNode): ScenarioNode {
  if (node.kind !== 'input') return node
  const cfg = node.config
  const params = cfg['params']
  if (!Array.isArray(params) || params.length === 0) return node
  if (!('name' in cfg) && !('valueType' in cfg)) return node
  const rest = { ...cfg }
  delete rest['name']
  delete rest['valueType']
  return { ...node, config: rest }
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
      onToggleBreakpoint: handlers.onToggleBreakpoint,
      ...(handlers.onOpenItem ? { onOpenItem: handlers.onOpenItem } : {}),
      ...(n.note !== undefined ? { note: n.note } : {}),
      ...(n.color !== undefined ? { color: n.color } : {}),
      ...(n.collapsed !== undefined ? { collapsed: n.collapsed } : {})
    }
  }
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

/** True only when a React Flow click event actually originated on the canvas.
 *
 * Popovers a node opens (the datetime calendar, the color picker, the type
 * menu, the autocomplete widget) are portaled to `<body>` but stay React
 * children of their host node — so React's synthetic events bubble from them up
 * the React tree into React Flow's `onNodeClick`/`onEdgeClick`, even though the
 * click landed outside the canvas DOM. Treating that as a node click would run
 * `dismissOffCanvasPopovers()` and immediately close the popover the user is
 * interacting with. A genuine node/edge click has its DOM target inside
 * `.react-flow`; a portal-bubbled one does not. */
function isCanvasOriginatedClick(event: { target: EventTarget | null }): boolean {
  return event.target instanceof Element && event.target.closest('.react-flow') !== null
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

const ScenarioEditorCanvas: React.FC<ScenarioEditorViewProps> = ({ scenario, tabId, projectUuid, onScenarioChange, resolveBoundItem, resolveRequestEnv, resolveSyntheticPreview, onOpenItem, onCreateRequest, onCreateChild }) => {
  const { t } = useTranslation()
  const { screenToFlowPosition, fitView, getNode, getViewport } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Gate mouse-wheel over a number input inside a scenario box. A number
  // InputBox consumes the wheel to increment/decrement AND stops propagation
  // (so the canvas can't zoom). That's only what the user wants when they are
  // deliberately editing that one box — i.e. it is the SOLE selected node.
  // Otherwise (no selection, a different box selected, or several selected) the
  // wheel should zoom the canvas, not nudge a value the cursor happened to land
  // on. We intercept in the capture phase — before the InputBox's own wheel
  // listener — and when the box isn't the sole selection we block the increment
  // and re-emit the wheel on the pane so React Flow zooms as usual.
  useEffect(() => {
    const root = wrapperRef.current
    if (!root) return
    const onWheelCapture = (e: WheelEvent): void => {
      const target = e.target as Element | null
      const numberInput = target?.closest('input[type="number"]')
      if (!numberInput) return
      const node = numberInput.closest('.react-flow__node')
      const selectedCount = root.querySelectorAll('.react-flow__node.selected').length
      const soleSelected = node !== null && node.classList.contains('selected') && selectedCount === 1
      if (soleSelected) return
      // Not the sole selection → suppress the value change and let the canvas
      // zoom instead by replaying the wheel on the pane (the re-dispatched
      // event targets the pane, not a number input, so it is ignored here).
      e.stopPropagation()
      e.preventDefault()
      const pane = root.querySelector('.react-flow__pane')
      pane?.dispatchEvent(new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        bubbles: true,
        cancelable: true
      }))
    }
    root.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    return () => { root.removeEventListener('wheel', onWheelCapture, { capture: true }) }
  }, [])

  // Batched node-internals sync. Each box asks to re-measure its handles after
  // it has measured its own row centres; a per-id `updateNodeInternals` is an
  // O(N) full-graph pass, so N boxes settling on open were O(N²) (seconds of
  // freeze). Coalesce a frame's worth of ids into a single
  // `updateNodeInternals([...ids])` — one O(N) pass for the whole batch.
  const updateNodeInternals = useUpdateNodeInternals()
  const pendingInternals = useRef<Set<string>>(new Set())
  const internalsRaf = useRef<number | null>(null)
  const requestNodeInternals = useCallback((nodeId: string) => {
    pendingInternals.current.add(nodeId)
    if (internalsRaf.current != null) return
    internalsRaf.current = requestAnimationFrame(() => {
      internalsRaf.current = null
      const ids = [...pendingInternals.current]
      pendingInternals.current.clear()
      if (ids.length > 0) updateNodeInternals(ids)
    })
  }, [updateNodeInternals])
  useEffect(() => () => { if (internalsRaf.current != null) cancelAnimationFrame(internalsRaf.current) }, [])
  // Whether THIS editor is the focused workbench tab (vs a background split).
  // Keyboard shortcuts + the Delete key gate on it, so e.g. F5 launches only
  // the active scenario, never every open one.
  const activeWorkbenchTabId = useContext(WorkbenchActiveTabContext)
  const isActiveTab = tabId !== undefined && tabId === activeWorkbenchTabId
  // Latest nodes (with their React-Flow `selected` flag) for the F9 keyboard
  // handler — `useReactFlow().getNodes()` doesn't reflect the editor's
  // selection here, but the `nodes` state does (it drives the inspector
  // preview). Synced via an effect below, once `nodes` is declared.
  const nodesRef = useRef<Node<NodeData>[]>([])
  // Same idea for edges — the static-preview callbacks (inspector / JSON-path
  // picker) read the live graph, but they run on user interaction, never during
  // render, so a post-commit ref keeps the preview API's identity stable instead
  // of rebuilding it (and re-rendering every box) on every drag tick.
  const edgesRef = useRef<Edge[]>([])
  // Phase 2 — real engine controller for this scenario tab. Drives the
  // inspector's Run / Pause / Step / Stop buttons + animates nodes /
  // edges off engine events.
  const engine = useScenarioEngine(scenario.id)
  // While a run is in flight (running OR paused) the graph is read-only:
  // no node drag, connect, delete, add, or config edit. A `ref` mirror lets
  // the imperative React Flow handlers (context menus, drop, connect) bail
  // without being re-created on every state flip.
  const locked = engine.state === 'running' || engine.state === 'paused'
  const lockedRef = useRef(locked)
  useEffect(() => { lockedRef.current = locked }, [locked])

  // Click-a-log-to-find-its-box: focus + flash a node. `flashSeq` bumps on
  // every request so re-clicking the SAME node replays the flash (the bumped
  // token remounts the box's flash overlay). Cleared after the animation.
  const [flash, setFlash] = useState<{ nodeId: string; seq: number } | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashSeqRef = useRef(0)
  // A read-only preview of a SUB-scenario, popped to the left of a clicked run-
  // log row that a sub-scenario produced — pan-zoomed + flashing the emitter
  // box. `token` retriggers the framing/flash when re-clicking the same node.
  const [subLogPopover, setSubLogPopover] = useState<{ scenario: Scenario; nodeId: string; x: number; y: number; token: number } | null>(null)
  const subLogTokenRef = useRef(0)
  const subLogAnchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current) }, [])
  // Dismiss the sub-scenario log popover on any pointer-down outside it (a click
  // on another log row closes this one, then re-opens for the new row). Deferred
  // a tick so the opening click doesn't immediately close it.
  useEffect(() => {
    if (!subLogPopover) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest('[data-scn-sublog-popover]')) setSubLogPopover(null)
    }
    const id = setTimeout(() => { window.addEventListener('mousedown', onDown) }, 0)
    return () => { clearTimeout(id); window.removeEventListener('mousedown', onDown) }
  }, [subLogPopover])
  const focusAndFlashNode = useCallback((nodeId: string): void => {
    // Only act when the node is in THIS scenario's graph. A run-log row can
    // point at a sub-scenario's node (not present here) or a since-deleted
    // node — in both cases there's nothing to focus, so do nothing.
    if (!getNode(nodeId)) return
    void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2 })
    flashSeqRef.current += 1
    setFlash({ nodeId, seq: flashSeqRef.current })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => { setFlash(null) }, 1200)
  }, [fitView, getNode])
  // Restore the graph's saved pan+zoom (user scope, per scenario). Read
  // synchronously from the primed cache so React Flow can seed its
  // `defaultViewport` on first render; fall back to `fitView` when none
  // is stored. Saved on pan/zoom via `onMove` (the store debounces).
  // `projectUuid` is passed from the workbench (this editor renders
  // OUTSIDE the EnvironmentProvider, so the env context isn't available).
  const savedViewport = projectUuid ? getScenarioViewport(projectUuid, scenario.id) : undefined

  // Debug breakpoints (user-scope store, NOT the scenario file). Mirrored into
  // local state so toggling repaints; the broken node also pan-zooms below.
  // `useReducer` (not `useState`) so the prune-on-load effect can refresh this
  // without tripping the React Compiler's set-state-in-effect rule.
  const [breakpointIds, setBreakpointIds] = useReducer((_prev: ReadonlySet<string>, next: ReadonlySet<string>) => next, new Set<string>())
  // Prune breakpoints whose node no longer exists (file edited elsewhere, or a
  // box deleted in-session) + reload, whenever the node set changes. A stale
  // breakpoint can't crash a run (the engine just never matches its id).
  useEffect(() => {
    if (!projectUuid) { setBreakpointIds(new Set()); return }
    pruneScenarioBreakpoints(projectUuid, scenario.id, new Set(scenario.nodes.map((n) => n.id)))
    setBreakpointIds(getScenarioBreakpoints(projectUuid, scenario.id))
  }, [projectUuid, scenario.id, scenario.nodes])
  const onToggleBreakpoint = useCallback((nodeId: string): void => {
    if (!projectUuid) return
    toggleBreakpoint(projectUuid, scenario.id, nodeId)
    const next = getScenarioBreakpoints(projectUuid, scenario.id)
    setBreakpointIds(next)
    // If a run is live, push the updated set so the scheduler honors a
    // breakpoint added (or removed) mid-execution. No-ops when nothing's running.
    void engine.setEngineBreakpoints([...next])
  }, [projectUuid, scenario.id, engine])
  // F9 = toggle breakpoints across the current selection: if ANY selected box
  // lacks a breakpoint, all selected get one; otherwise (all already have one)
  // all are cleared. Mirrors the per-node glyph but batched.
  const toggleBreakpointsOnSelection = useCallback((): void => {
    if (!projectUuid) return
    const selected = nodesRef.current.filter((n) => n.selected).map((n) => n.id)
    if (selected.length === 0) return
    const current = getScenarioBreakpoints(projectUuid, scenario.id)
    const anyMissing = selected.some((id) => !current.has(id))
    for (const id of selected) {
      const has = current.has(id)
      // anyMissing → add to those without one; otherwise → remove from all.
      if (anyMissing ? !has : has) toggleBreakpoint(projectUuid, scenario.id, id)
    }
    const next = getScenarioBreakpoints(projectUuid, scenario.id)
    setBreakpointIds(next)
    void engine.setEngineBreakpoints([...next])
  }, [projectUuid, scenario.id, engine])

  // Keyboard shortcuts — only the FOCUSED workbench tab handles them, so e.g.
  // F5 launches just this scenario, never every open one. Ignored while typing
  // in a field / Monaco. App scheme (not VS Code's): F5 run · F6 debug · F7
  // step · F8 stop · Pause pause/resume · F9 toggle breakpoint(s).
  // F5 LAUNCHES only — it never pauses a live run (the Pause key owns
  // pause/resume, as a toggle). The inspector's play button still toggles
  // run/pause, but the shortcut deliberately doesn't, so a double-tap of F5
  // can't pause. F6/F7/F8 mirror the inspector handlers (onDebug/onStep/onStop).
  useEffect(() => {
    if (!isActiveTab) return undefined
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.closest('.monaco-editor'))) return
      const hasBreakpoints = breakpointIds.size > 0
      switch (e.key) {
        case 'F5':
          e.preventDefault()
          // Launch only. A live run is left untouched — pausing is the Pause
          // key's job, so hitting F5 twice can never pause.
          if (engine.state !== 'running' && engine.state !== 'paused') {
            void engine.start(scenario.id, {}, false, [...breakpointIds], false)
          }
          break
        case 'F6':
          e.preventDefault()
          if (!hasBreakpoints) break
          if (engine.state === 'running' || engine.state === 'paused') {
            void engine.setEngineBreakpoints([...breakpointIds])
            void engine.enableDebug()
            if (engine.state === 'paused') void engine.resume()
          } else void engine.start(scenario.id, {}, false, [...breakpointIds], true)
          break
        case 'F7':
          e.preventDefault()
          if (engine.state === 'paused' || engine.state === 'running') void engine.step()
          else void (async () => { await engine.start(scenario.id, {}, true); await engine.step() })()
          break
        case 'F8':
          e.preventDefault()
          void engine.stop()
          break
        case 'Pause':
          e.preventDefault()
          // Toggle: pause a running scenario, resume a paused one.
          if (engine.state === 'running') void engine.pause()
          else if (engine.state === 'paused') void engine.resume()
          break
        case 'F9':
          e.preventDefault()
          toggleBreakpointsOnSelection()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [isActiveTab, engine, scenario.id, breakpointIds, toggleBreakpointsOnSelection])

  // Pan-zoom onto the node a debug run is paused at (breakpoint) or the box the
  // user just stepped into — only while paused, so a full-speed run isn't yanked
  // around. On a breakpoint / step the engine names the exact node. On a PLAIN
  // pause it doesn't, so aim at the frontier — the box that was in flight at the
  // pause, i.e. the most recent one to finish WHILE paused (the same box that
  // earns the yellow frame). `lastStartedNodeId` is wrong here: on a fan-out
  // it's whichever sibling branch happened to fire last, not where we paused.
  const frontierFocusId = engine.completedNodeIds.size > 0
    ? [...engine.completedNodeIds][engine.completedNodeIds.size - 1]
    : null
  const debugFocusId = engine.pausedAtNodeId ?? frontierFocusId
  useEffect(() => {
    if (engine.state !== 'paused' || !debugFocusId || !getNode(debugFocusId)) return
    void fitView({ nodes: [{ id: debugFocusId }], duration: 400, maxZoom: 1.2 })
  }, [engine.state, debugFocusId, fitView, getNode])
  // Run-history overlay open state, driven by the tab-header button's
  // SCENARIO_RUN_HISTORY_OPEN event (scoped to this scenario's id).
  const [historyOpen, setHistoryOpen] = useState(false)
  useEffect(() => {
    const sub = eventBus.subscribe<ScenarioRunHistoryOpenPayload>(SCENARIO_RUN_HISTORY_OPEN, (payload) => {
      if (payload.scenarioId === scenario.id) setHistoryOpen(true)
    })
    return () => { sub.unsubscribe() }
  }, [scenario.id])

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
  // Keep `nodesRef` (used by the F9 keyboard handler defined above) pointed at
  // the latest nodes + their selection.
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  useEffect(() => { edgesRef.current = edges }, [edges])
  const [palette, setPalette] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)
  const [showMinimap, setShowMinimap] = useState(false)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  // Bulk menu for a MULTI-selection right-click (change colour / delete), and
  // the cursor-anchored colour picker it opens (applied to every selected box).
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; nodeIds: string[] } | null>(null)
  const [multiColorPicker, setMultiColorPicker] = useState<{ x: number; y: number; nodeIds: string[] } | null>(null)
  const multiColorAnchorRef = useRef<HTMLDivElement>(null)
  const [colorPickerNodeId, setColorPickerNodeId] = useState<string | null>(null)
  // The header element the colour-picker tooltip anchors its beak to.
  const colorTargetRef = useRef<HTMLElement | null>(null)
  // Tooltip placement computed when the picker opens (so render reads state,
  // not the anchor ref).
  const [colorPlacement, setColorPlacement] = useState<{ placement: 'above' | 'below'; side: 'auto' | 'left' | 'right' }>({ placement: 'above', side: 'auto' })
  const [noteEditorNodeId, setNoteEditorNodeId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  // Undo / redo history for this scenario tab. A snapshot is the full graph
  // (nodes + edges), so undo restores structure, positions, config edits,
  // colours and breakpoints alike. The stack is ref-held (no re-render on
  // capture) and bounded; `currentJson` dedupes consecutive identical persists
  // and short-circuits the persist a restore itself triggers. History is
  // per-scenario: the seed effect resets it when the open scenario changes.
  const HISTORY_LIMIT = 50
  const historyRef = useRef<{
    past: ScenarioSnapshot[]
    future: ScenarioSnapshot[]
    current: ScenarioSnapshot | null
    currentJson: string
  }>({ past: [], future: [], current: null, currentJson: '' })
  const isRestoringRef = useRef(false)
  // True while a single user action's burst of persists is being coalesced into
  // ONE history step. Deleting a box, for instance, fires two persists (the node
  // removal AND the removal of its connected edges); without this they'd land as
  // two separate undo steps, so one Ctrl+Z would bring the box back but not its
  // links. Set on the first persist of a batch, cleared on the next macrotask
  // (after the event's synchronous + microtask work has drained).
  const coalesceRef = useRef(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const persist = useCallback((flowNodes: Node<NodeData>[], flowEdges: Edge[]) => {
    const nextNodes: ScenarioNode[] = flowNodes.map((fn) => {
      const prior = nodeStore.current.get(fn.id)
      // Serialize the LIVE React Flow node data, not the authoritative store:
      // `setNodeConfig` always updates `fn.data.config`, but the matching
      // `nodeStore` write can lag for out-of-band (MCP-created) nodes, leaving
      // `prior.config` stale — which is why successive config edits persisted
      // only the first. The store stays the fallback for `config` (the only
      // optional field on the node data); `inputs`/`outputs` are always carried.
      return canonicalScenarioNode({
        id: fn.id,
        kind: fn.data.kind,
        config: fn.data.config ?? prior?.config ?? {},
        inputs: fn.data.inputs,
        outputs: fn.data.outputs,
        position: fn.position,
        ...(prior?.note !== undefined ? { note: prior.note } : {}),
        ...(prior?.color !== undefined ? { color: prior.color } : {}),
        ...(prior?.collapsed !== undefined ? { collapsed: prior.collapsed } : {})
      })
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
    queueMicrotask(() => {
      onScenarioChange?.(scenario.id, { nodes: nextNodes, edges: nextEdges })
      // Snapshot for undo/redo — skip the write a restore itself triggers and
      // any persist that didn't actually change the serialized graph.
      if (isRestoringRef.current) return
      const snapJson = JSON.stringify({ n: nextNodes, e: nextEdges })
      const h = historyRef.current
      if (snapJson === h.currentJson) return
      // Coalesce a burst of persists from ONE user action into a single undo
      // step: only the first persist of the batch pushes the pre-batch state
      // onto `past`; the rest just advance `current`. The flag clears on the
      // next macrotask, once the event's synchronous + microtask work is done.
      if (!coalesceRef.current) {
        if (h.current) {
          h.past.push(h.current)
          if (h.past.length > HISTORY_LIMIT) h.past.shift()
        }
        coalesceRef.current = true
        setTimeout(() => { coalesceRef.current = false }, 0)
      }
      h.future = []
      h.current = { nodes: nextNodes, edges: nextEdges }
      h.currentJson = snapJson
      setCanUndo(h.past.length > 0)
      setCanRedo(false)
    })
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
      const nodes = nodesRef.current, edges = edgesRef.current
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
      const target = nodesRef.current.find((n) => n.id === nodeId)
      return target ? collectObjectWiredProps(target, nodesRef.current, edgesRef.current) : []
    },
    getListItemShape: (listNodeId: string) => {
      const nodes = nodesRef.current, edges = edgesRef.current
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
      const runNode = nodesRef.current.find((n) => n.id === runScenarioNodeId)
      return runNode ? computeRunScenarioOutputs(runNode, resolveBoundItem) : null
    }
    // Reads live `nodes` / `edges` via refs inside the callbacks (they fire on
    // user interaction, not render), so this API's identity stays stable across
    // drag ticks — only `resolveBoundItem` actually parameterizes it.
  }), [resolveBoundItem])

  // Resolve a scenario reference (a runScenario's sub-scenario) to derive its
  // ports — for orphan-edge detection and the derived call-signature ports.
  const resolveScenario = useCallback((sid: string): Scenario | null => {
    const it = resolveBoundItem?.(sid) ?? null
    return it && isScenario(it) ? it : null
  }, [resolveBoundItem])

  // A run-log row click. Same-scenario node → pan-zoom + flash it in place.
  // A node from a SUB-scenario (the entry carries that scenario's id, and it's
  // not in this graph) → pop a read-only preview of that sub-scenario to the
  // left of the row, pan-zoomed + flashing the emitter. A since-deleted node /
  // unresolvable scenario falls through to the in-place attempt (a no-op).
  const onLogFocus = useCallback((nodeId: string, scenarioId?: string, anchor?: { x: number; y: number }): void => {
    if (scenarioId !== undefined && scenarioId !== scenario.id && !getNode(nodeId)) {
      const sub = resolveScenario(scenarioId)
      if (sub) {
        subLogTokenRef.current += 1
        setSubLogPopover({ scenario: sub, nodeId, x: anchor?.x ?? 0, y: anchor?.y ?? 0, token: subLogTokenRef.current })
        return
      }
    }
    focusAndFlashNode(nodeId)
  }, [scenario.id, getNode, resolveScenario, focusAndFlashNode])

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
    // A runScenario's VALID ports are its static ports (the `in` trigger, the
    // `result` output) PLUS the derived `param:`/`output:` ports. Only a
    // derived port can be stranded by a sub-scenario rename — so an edge is an
    // orphan only when its endpoint is in NEITHER set. (Checking the derived
    // set alone wrongly flags an edge to the static `in`/`result`, e.g. a loop
    // body wired `…then → runScenario.in`.)
    const tgt = nodeStore.current.get(e.to.nodeId)
    const tgtDerived = derivedPortsOf(tgt)
    if (tgtDerived && tgt) {
      const valid = new Set<string>([...defaultPortsForKind(tgt.kind).inputs.map((p) => p.id), ...tgtDerived.inputs.map((p) => p.id)])
      if (!valid.has(e.to.portId)) return true
    }
    const src = nodeStore.current.get(e.from.nodeId)
    const srcDerived = derivedPortsOf(src)
    if (srcDerived && src) {
      const valid = new Set<string>(['error', 'done', ...defaultPortsForKind(src.kind).outputs.map((p) => p.id), ...srcDerived.outputs.map((p) => p.id)])
      if (!valid.has(e.from.portId)) return true
    }
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
    const stroke = e.color ?? edgeColorForHandle(e.from.portId, port)
    const styled = withSel(stroke ? { ...fe, style: { ...(fe.style ?? {}), stroke } } : fe)
    // An OR-gate receiver ("run on each event") draws its `in` predecessor
    // links DASHED, so the non-blocking fire-on-each join reads at a glance vs
    // the solid AND-join. View-only: derived from the target node's flag, never
    // persisted on the edge (re-derived here on every reseed).
    const targetRunsOnEach = e.to.portId === 'in'
      && nodeStore.current.get(e.to.nodeId)?.config['runOnEachEvent'] === true
    return targetRunsOnEach
      ? { ...styled, data: { ...(styled.data ?? {}), runOnEachReceiver: true }, style: { ...(styled.style ?? {}), strokeDasharray: '6 4' } }
      : styled
  }, [isOrphanEdge, derivedPortsOf])

  // Re-seed the canvas + authoritative stores from a history snapshot, then push
  // it to the parent so it autosaves. The `isRestoringRef` guard keeps the
  // resulting persist from recording a new history entry; `currentJson` is set
  // so a redundant follow-up persist is a no-op too.
  const restoreSnapshot = useCallback((snap: ScenarioSnapshot) => {
    isRestoringRef.current = true
    nodeStore.current = new Map(snap.nodes.map((n) => [n.id, n]))
    edgeStore.current = new Map(snap.edges.map((e) => [e.id, e]))
    setNodes(snap.nodes.map((n) => toFlowNode(n, handlers.current)))
    setEdges(snap.edges.map(buildFlowEdge))
    historyRef.current.current = snap
    historyRef.current.currentJson = JSON.stringify({ n: snap.nodes, e: snap.edges })
    queueMicrotask(() => {
      onScenarioChange?.(scenario.id, { nodes: snap.nodes, edges: snap.edges })
      isRestoringRef.current = false
    })
  }, [setNodes, setEdges, buildFlowEdge, onScenarioChange, scenario.id])

  const undo = useCallback(() => {
    const h = historyRef.current
    const prev = h.past[h.past.length - 1]
    if (prev === undefined || !h.current) return
    h.past.pop()
    h.future.push(h.current)
    restoreSnapshot(prev)
    setCanUndo(h.past.length > 0)
    setCanRedo(true)
  }, [restoreSnapshot])

  const redo = useCallback(() => {
    const h = historyRef.current
    const next = h.future[h.future.length - 1]
    if (next === undefined || !h.current) return
    h.future.pop()
    h.past.push(h.current)
    restoreSnapshot(next)
    setCanUndo(true)
    setCanRedo(h.future.length > 0)
  }, [restoreSnapshot])

  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  const [edgeColorPicker, setEdgeColorPicker] = useState<{ edgeId: string; x: number; y: number } | null>(null)
  // Cursor-anchored invisible target for the edge colour-picker tooltip (edges
  // have no stable DOM element to pin a beak to, unlike a node header).
  const edgeColorAnchorRef = useRef<HTMLDivElement>(null)

  // Toggle a node's collapsed flag; update the live node + persist. The
  // `nodeStore` write has to derive its target value from `fn.data.collapsed`
  // (the snapshot React passes into the updater), NOT from `prior.collapsed`
  // — under React StrictMode the updater is invoked twice, so a side-effect
  // that toggles based on the (mutating) `nodeStore` value flips twice and
  // cancels itself out, leaving the store in its pre-click state while the
  // live React Flow state correctly ends at the new value. That divergence
  // is what stops the persisted file from picking up the collapse.
  const onToggleCollapse = useCallback((nodeId: string) => {
    setNodes((curr) => {
      const target = curr.find((x) => x.id === nodeId)
      if (!target) return curr
      const newCollapsed = !target.data.collapsed
      const next = curr.map((fn) =>
        fn.id === nodeId ? { ...fn, data: { ...fn.data, collapsed: newCollapsed } } : fn
      )
      const prior = nodeStore.current.get(nodeId)
      if (prior) nodeStore.current.set(nodeId, { ...prior, collapsed: newCollapsed })
      setEdges((e) => { persist(next, e); return e })
      return next
    })
  }, [setNodes, setEdges, persist])

  // Right-click on a header: select that node (deselect the rest) AND open
  // the node context menu at the cursor.
  // Close the cursor-anchored Tooltip popovers (colour pickers, sub-log preview)
  // — unlike the ContextMenus, which self-dismiss on any outside pointerdown,
  // these only close on the left-click pane handler, so a right-click that opens
  // a new menu would otherwise leave them lingering. Each right-click opener
  // calls this first.
  const closeOverlays = useCallback((): void => {
    setMultiColorPicker(null); setColorPickerNodeId(null); setEdgeColorPicker(null); setSubLogPopover(null)
  }, [])

  const onHeaderContextMenu = useCallback((nodeId: string, x: number, y: number) => {
    closeOverlays()
    // Right-clicking a box that's part of a MULTI-selection → the bulk menu,
    // selection preserved (don't collapse it to the one box).
    const selectedIds = nodesRef.current.filter((n) => n.selected).map((n) => n.id)
    if (selectedIds.length > 1 && selectedIds.includes(nodeId)) {
      setNodeMenu(null)
      setSelectionMenu({ x, y, nodeIds: selectedIds })
      return
    }
    setNodes((curr) => curr.map((fn) => (fn.selected === (fn.id === nodeId) ? fn : { ...fn, selected: fn.id === nodeId })))
    setNodeMenu({ nodeId, x, y })
  }, [setNodes, closeOverlays])

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

  // Flip a node's `in` join mode: AND-join barrier (default) ⇄ OR gate (fire on
  // each event). The flag is persisted in the node config (the scheduler reads
  // it at run start); the dashed `in` predecessor links are view-only, restyled
  // here in step with the toggle (and re-derived by `buildFlowEdge` on reseed).
  const toggleRunOnEachEvent = useCallback((nodeId: string) => {
    const next = nodeStore.current.get(nodeId)?.config['runOnEachEvent'] !== true
    setNodeConfig(nodeId, { runOnEachEvent: next })
    setEdges((es) => es.map((fe) => {
      if (fe.target !== nodeId || fe.targetHandle !== 'in' || fe.data?.['orphan'] === true) return fe
      const style = { ...(fe.style ?? {}) }
      if (next) style.strokeDasharray = '6 4'
      else delete style.strokeDasharray
      return { ...fe, data: { ...(fe.data ?? {}), runOnEachReceiver: next || undefined }, style }
    }))
  }, [setNodeConfig, setEdges])

  const handlers = useRef<NodeHandlers>({ scenarioId: scenario.id, onToggleCollapse, onHeaderContextMenu, onSetConfig: setNodeConfig, onToggleBreakpoint, ...(onOpenItem ? { onOpenItem } : {}) })
  useEffect(() => { handlers.current = { scenarioId: scenario.id, onToggleCollapse, onHeaderContextMenu, onSetConfig: setNodeConfig, onToggleBreakpoint, ...(onOpenItem ? { onOpenItem } : {}) } }, [scenario.id, onToggleCollapse, onHeaderContextMenu, setNodeConfig, onToggleBreakpoint, onOpenItem])

  // Seed from the scenario only when the open scenario changes (tab switch).
  // The guard makes our own persist writes (which replace `scenario.nodes`)
  // no-ops here, so selection / drag state survives a move.
  useEffect(() => {
    if (seededId.current === scenario.id) return
    seededId.current = scenario.id
    // Pre-existing scenarios may carry edges left orphaned by an earlier property
    // / case removal (the bug class fixed in `setNodeConfig`), OR DUPLICATE edges
    // sharing one id (a MERGE link persisted twice slips past the connect guard).
    // Drop both once at load so the persisted file converges with what the editor
    // can render — and React Flow isn't handed two children with the same key
    // (which floods the console with key warnings on every run re-render).
    // Strip obsolete legacy single-param fields off migrated input nodes (same
    // converge-on-load treatment as the orphan-edge sweep below).
    const cleanNodes = scenario.nodes.map(stripLegacyInputFields)
    const nodesChanged = cleanNodes.some((n, i) => n !== scenario.nodes[i])
    const nodeBy = new Map(cleanNodes.map((n) => [n.id, n]))
    const seenEdgeIds = new Set<string>()
    const cleanEdges = scenario.edges.filter((e) => {
      if (isOrphanDynamicEdge(
        { source: e.from.nodeId, target: e.to.nodeId, sourceHandle: e.from.portId, targetHandle: e.to.portId },
        (id) => nodeBy.get(id)
      )) return false
      if (seenEdgeIds.has(e.id)) return false
      seenEdgeIds.add(e.id)
      return true
    })
    nodeStore.current = new Map(cleanNodes.map((n) => [n.id, n]))
    edgeStore.current = new Map(cleanEdges.map((e) => [e.id, e]))
    setNodes(cleanNodes.map((n) => toFlowNode(n, handlers.current)))
    setEdges(cleanEdges.map(buildFlowEdge))
    // Reset undo/redo to the freshly loaded graph as the baseline — history is
    // per-scenario, so switching tabs starts a clean stack the first edit can
    // undo back to. The baseline is serialized through the SAME canonical
    // shapes `persist` emits, so the no-op persist React Flow fires right after
    // a load matches `currentJson` and is deduped (no phantom undo step).
    const baseNodes = cleanNodes.map((n) =>
      canonicalScenarioNode({
        id: n.id,
        kind: n.kind,
        config: n.config,
        inputs: n.inputs,
        outputs: n.outputs,
        position: n.position,
        ...(n.note !== undefined ? { note: n.note } : {}),
        ...(n.color !== undefined ? { color: n.color } : {}),
        ...(n.collapsed !== undefined ? { collapsed: n.collapsed } : {})
      })
    )
    const baseEdges = cleanEdges.map((e) =>
      flowEdgeToScenarioEdge(
        { id: e.id, source: e.from.nodeId, target: e.to.nodeId, sourceHandle: e.from.portId, targetHandle: e.to.portId },
        e
      )
    )
    historyRef.current = {
      past: [],
      future: [],
      current: { nodes: baseNodes, edges: baseEdges },
      currentJson: JSON.stringify({ n: baseNodes, e: baseEdges })
    }
    coalesceRef.current = false
    setCanUndo(false)
    setCanRedo(false)
    if (nodesChanged || cleanEdges.length !== scenario.edges.length) {
      // Schedule a persist so the cleanup makes it back to disk on the next
      // autosave. Defer to a microtask: the parent owns scenario state, and a
      // synchronous patch dispatch from inside this effect would race the
      // initial render that just seeded the editor.
      const patch: { nodes?: ScenarioNode[]; edges?: Scenario['edges'] } = {}
      if (nodesChanged) patch.nodes = cleanNodes
      if (cleanEdges.length !== scenario.edges.length) patch.edges = cleanEdges
      queueMicrotask(() => { onScenarioChange?.(scenario.id, patch) })
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

  // Re-seed edges when a bound sub-scenario renamed a port: the parent App
  // remaps THIS caller's `output:<name>` / `param:<name>` edge handles to the
  // new name (so the connection follows the rename instead of orphaning) and
  // pushes the remapped edges here. Edges only — the node set is unchanged.
  useEffect(() => {
    const sub = eventBus.subscribe('restorm:scenario:edges-remapped', (payload: unknown) => {
      const p = payload as { scenarioId?: unknown; edges?: unknown }
      if (p.scenarioId !== scenario.id || !Array.isArray(p.edges)) return
      const es = p.edges as Scenario['edges']
      edgeStore.current = new Map(es.map((e) => [e.id, e]))
      setEdges(es.map(buildFlowEdge))
    })
    return () => { sub.unsubscribe() }
  }, [scenario.id, setEdges, buildFlowEdge])

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

  // The JSON-path selector to seed on a new DATA link (a value/both output into
  // a data input). Mirrors what the user would otherwise pick: an object-context
  // input gets the source's single top-level key (or `.`); any other data input
  // gets the single-deep path (or `.`). Returns undefined when it isn't a data
  // link (a signal / header wire carries no selectable value). Shared by the
  // drag-onto-existing-box (`onConnect`) and drag-into-empty (`addLinkedNode`)
  // paths so both auto-discover the path identically.
  const computeDataLinkSelector = useCallback((
    src: { id: string; kind: ScenarioNodeKind; config?: Record<string, unknown>; outputs: ScenarioPort[] },
    srcHandle: string,
    tgt: { kind: ScenarioNodeKind; inputs: ScenarioPort[] },
    tgtHandle: string
  ): string | undefined => {
    const srcDerived = derivedPortsOf(src)?.outputs ?? []
    const outFlow = outputPortFlow([...src.outputs, ...srcDerived], srcHandle, src.kind)
    const inFlow = inputPortFlow(tgt.inputs, tgtHandle, tgt.kind)
    if (!isDataLink(inFlow, outFlow)) return undefined
    const preview = STATIC_PREVIEW_KINDS.has(src.kind)
      ? staticScenarioPreview(
          { id: src.id, kind: src.kind, config: src.config ?? {} },
          nodes.map((x) => ({ id: x.id, kind: x.data.kind, config: x.data.config ?? {} })),
          edges.flatMap((e) => (e.source && e.target && e.sourceHandle && e.targetHandle)
            ? [{ from: { nodeId: e.source, portId: e.sourceHandle }, to: { nodeId: e.target, portId: e.targetHandle }, ...(typeof e.data?.['selector'] === 'string' ? { selector: e.data['selector'] } : {}) }]
            : [])
        )
      : null
    const pv = preview ? portPreviewValue(preview, srcHandle, src.kind) : null
    if (expectsObjectInput(tgt.kind, tgtHandle)) return (pv ? singleTopLevelKey(pv) : null) ?? '.'
    return (pv ? singleDeepPath(pv) : null) ?? '.'
  }, [derivedPortsOf, nodes, edges])

  const onConnect = useCallback((connection: Connection) => {
    if (lockedRef.current) return
    if (!validateConnection(connection)) return
    const id = `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const src = nodes.find((n) => n.id === connection.source)
    const tgt = nodes.find((n) => n.id === connection.target)
    const port = src?.data.outputs.find((o) => o.id === connection.sourceHandle)
      ?? (src ? derivedPortsOf(src.data)?.outputs.find((o) => o.id === connection.sourceHandle) : undefined)
    const stroke = edgeColorForHandle(connection.sourceHandle, port)
    // Auto-fill the JSON path when a data link's source has an unambiguous
    // (single-deep) preview — e.g. a getVariable `{ timer }` link deduces
    // `timer` outright, so the user needn't open the picker.
    let selector: string | undefined
    if (src && tgt && connection.sourceHandle && connection.targetHandle) {
      // Auto-discover the JSON path for a data link (`.` when none is deducible
      // — an array / runtime-only source — so the link never trips the "needs a
      // path" validation). The selector lives authoritatively in `edgeStore`
      // (persist rebuilds each ScenarioEdge from it), so seed it there too.
      selector = computeDataLinkSelector(
        { id: src.id, kind: src.data.kind, config: src.data.config ?? {}, outputs: src.data.outputs },
        connection.sourceHandle,
        { kind: tgt.data.kind, inputs: tgt.data.inputs },
        connection.targetHandle
      )
      if (selector !== undefined) {
        edgeStore.current.set(id, {
          id,
          from: { nodeId: src.id, portId: connection.sourceHandle },
          to: { nodeId: tgt.id, portId: connection.targetHandle },
          selector
        })
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
    // A link drawn ONTO an OR-gate receiver's `in` must be dashed too (the
    // existing links got restyled when the flag flipped; a fresh one is born
    // after, so it needs the same view-only dash here).
    const targetRunsOnEach = connection.targetHandle === 'in' && tgt?.data.config?.['runOnEachEvent'] === true
    const newStyle = { ...(stroke ? { stroke } : {}), ...(targetRunsOnEach ? { strokeDasharray: '6 4' } : {}) }
    const newData = { ...(selector ? { selector } : {}), ...(targetRunsOnEach ? { runOnEachReceiver: true } : {}) }
    setEdges((curr) => {
      const next = addEdge({ ...connection, id, ...(Object.keys(newStyle).length ? { style: newStyle } : {}), ...(Object.keys(newData).length ? { data: newData } : {}) }, curr)
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
  }, [setEdges, setNodes, persist, validateConnection, nodes, derivedPortsOf, computeDataLinkSelector])

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
  // opens the link palette) immediately followed by `onPaneClick` — the same
  // release counts as a pane click and would close the palette we just opened.
  // Flag it so that ONE pane-click is ignored. (A time-based guard was flaky: a
  // slow re-render delays the pane-click past any fixed threshold, so the
  // palette opened then closed itself intermittently.)
  const linkPaletteJustOpened = useRef(false)
  const [linkPalette, setLinkPalette] = useState<{
    x: number; y: number; flow: { x: number; y: number }
    fromNodeId: string; fromHandle: string; fromIsSource: boolean
    entries: { kind: ScenarioNodeKind; wirePort: string }[]
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
    // Connectable kinds + the port to auto-wire on each (see linkPaletteEntries).
    // The render orders / labels them via the shared catalogue builder, so the
    // link palette reads identically to the canvas one. A runScenario's derived
    // ports (incl. the `done` trigger) join the static set so the dragged port's
    // flow is classified correctly.
    const srcDerived = derivedPortsOf(srcNode.data)
    const entries = linkPaletteEntries(
      {
        kind: srcNode.data.kind,
        inputs: srcDerived ? [...srcNode.data.inputs, ...srcDerived.inputs] : srcNode.data.inputs,
        outputs: srcDerived ? [...srcNode.data.outputs, ...srcDerived.outputs] : srcNode.data.outputs
      },
      fromHandle,
      fromIsSource
    )
    if (entries.length === 0) return
    const pt = 'changedTouches' in event ? event.changedTouches[0] : event
    const x = pt?.clientX ?? 0
    const y = pt?.clientY ?? 0
    linkPaletteJustOpened.current = true
    setLinkPalette({ x, y, flow: screenToFlowPosition({ x, y }), fromNodeId: start.nodeId, fromHandle, fromIsSource, entries })
  }, [nodes, screenToFlowPosition, derivedPortsOf])

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
    const stroke = edgeColorForHandle(edge.sourceHandle, srcPort)
    if (stroke) edge.style = { stroke }
    // Auto-discover the JSON path for the new DATA link — exactly like a drag
    // onto an existing box — so it lands ready (not red for a missing path).
    const tgtN = nodeStore.current.get(edge.target)
    if (srcN && tgtN && edge.sourceHandle && edge.targetHandle) {
      const selector = computeDataLinkSelector(srcN, edge.sourceHandle, tgtN, edge.targetHandle)
      if (selector !== undefined) {
        edge.data = { ...(edge.data ?? {}), selector }
        edgeStore.current.set(edge.id, {
          id: edge.id,
          from: { nodeId: edge.source, portId: edge.sourceHandle },
          to: { nodeId: edge.target, portId: edge.targetHandle },
          selector
        })
      }
    }
    // Append idempotently: `setEdges` runs INSIDE the `setNodes` updater, and
    // React StrictMode double-invokes that updater in dev — without the
    // id-guards the edge (and node) got appended twice, so the new box fired
    // twice (two identical log entries) and the dupe was persisted.
    setNodes((curr) => {
      const next = curr.some((n) => n.id === node.id) ? curr : [...curr, toFlowNode(node, handlers.current)]
      setEdges((e) => {
        const ne = e.some((x) => x.id === edge.id) ? e : [...e, edge]
        persist(next, ne)
        return ne
      })
      return next
    })
    setLinkPalette(null)
  }, [linkPalette, setNodes, setEdges, persist, derivedPortsOf, computeDataLinkSelector])

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
    if (lockedRef.current) return
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

  // Bulk-delete every node in `ids` (+ any edge touching one) in a single pass.
  const deleteNodes = useCallback((ids: string[]) => {
    setSelectionMenu(null)
    const idSet = new Set(ids)
    setNodes((curr) => {
      const next = curr.filter((n) => !idSet.has(n.id))
      setEdges((e) => {
        const ne = e.filter((ed) => !idSet.has(ed.source) && !idSet.has(ed.target))
        persist(next, ne)
        return ne
      })
      return next
    })
  }, [setNodes, setEdges, persist])

  // Set (or reset, with `undefined`) the box colour of EVERY node in `ids`.
  const setNodesColor = useCallback((ids: string[], color: string | undefined) => {
    const idSet = new Set(ids)
    setNodes((curr) => {
      const next = curr.map((fn) => {
        if (!idSet.has(fn.id)) return fn
        const data = { ...fn.data }
        if (color === undefined) delete data.color
        else data.color = color
        return { ...fn, data }
      })
      for (const id of ids) {
        const prior = nodeStore.current.get(id)
        if (!prior) continue
        const updated = { ...prior }
        if (color === undefined) delete updated.color
        else updated.color = color
        nodeStore.current.set(id, updated)
      }
      setEdges((e) => { persist(next, e); return e })
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

  // Duplicate EVERY node in `ids` at once (the multi-selection bulk action):
  // clone each box offset from its source AND re-create the edges that run
  // BETWEEN two selected boxes (remapped onto the clones), then select the copies.
  // An edge with one end outside the selection is left alone — its other end
  // has no counterpart on the copy.
  const duplicateNodes = useCallback((ids: string[]) => {
    setSelectionMenu(null)
    const idSet = new Set(ids)
    const idMap = new Map<string, string>()
    const clones: ScenarioNode[] = []
    let cloneIndex = 0
    for (const oldId of ids) {
      const src = nodeStore.current.get(oldId)
      if (!src) continue
      // Fresh, unique id per clone — never the source's id. The loop index makes
      // it collision-proof even when several clones are minted in the same ms
      // (Date.now() is identical across a synchronous batch).
      const newId = `${Date.now()}-${cloneIndex++}-${Math.random().toString(36).slice(2, 8)}`
      idMap.set(oldId, newId)
      const clone: ScenarioNode = {
        ...src,
        id: newId,
        position: { x: src.position.x + 40, y: src.position.y + 40 },
        config: { ...src.config },
        inputs: src.inputs.map((p) => ({ ...p })),
        outputs: src.outputs.map((p) => ({ ...p }))
      }
      nodeStore.current.set(newId, clone)
      clones.push(clone)
    }
    if (clones.length === 0) return
    // Build the next nodes + edges ONCE from the live refs, then set both and
    // persist in one shot. Do NOT nest `setEdges` inside a `setNodes` updater:
    // React StrictMode double-invokes updaters, so a nested `setEdges` runs
    // twice and — because it APPENDS clones derived from the current edges — the
    // internal links get cloned twice (the phantom duplicate-link bug).
    const nextNodes = [
      ...nodesRef.current.map((n) => ({ ...n, selected: false })),
      ...clones.map((c) => ({ ...toFlowNode(c, handlers.current), selected: true }))
    ]
    const clonedEdges = edgesRef.current
      .filter((ed) => idSet.has(ed.source) && idSet.has(ed.target))
      .map((ed, i) => ({
        ...ed,
        id: `e-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        source: idMap.get(ed.source) ?? ed.source,
        target: idMap.get(ed.target) ?? ed.target,
        selected: false,
        ...(ed.data ? { data: { ...ed.data } } : {})
      }))
    const nextEdges = [...edgesRef.current, ...clonedEdges]
    setNodes(nextNodes)
    setEdges(nextEdges)
    persist(nextNodes, nextEdges)
  }, [setNodes, setEdges, persist])

  // Copy the selected boxes + the edges BETWEEN them to the app-internal
  // clipboard, so they can be pasted into this or another scenario.
  const copyNodes = useCallback((ids: string[]) => {
    setNodeMenu(null)
    setSelectionMenu(null)
    const idSet = new Set(ids)
    const nodes = ids.map((id) => nodeStore.current.get(id)).filter((n): n is ScenarioNode => n !== undefined)
    if (nodes.length === 0) return
    const edges = edgesRef.current
      .filter((ed) => idSet.has(ed.source) && idSet.has(ed.target))
      .map((ed) => edgeStore.current.get(ed.id))
      .filter((e): e is ScenarioEdge => e !== undefined)
    // Centre of the copied group in flow coords (bbox of the live flow nodes,
    // which carry measured sizes) + the viewport at copy time — drives the
    // pan-aware paste placement.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const fn of nodesRef.current) {
      if (!idSet.has(fn.id)) continue
      const w = fn.measured?.width ?? fn.width ?? 0
      const h = fn.measured?.height ?? fn.height ?? 0
      minX = Math.min(minX, fn.position.x)
      minY = Math.min(minY, fn.position.y)
      maxX = Math.max(maxX, fn.position.x + w)
      maxY = Math.max(maxY, fn.position.y + h)
    }
    const center = Number.isFinite(minX)
      ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
      : { x: 0, y: 0 }
    setScenarioClipboard(nodes, edges, center, getViewport())
  }, [getViewport])

  // Paste the clipboard into THIS scenario: fresh ids for every box + its
  // internal edges (remapped), offset like a duplicate, copies selected.
  const pasteNodes = useCallback(() => {
    setPalette(null)
    setNodeMenu(null)
    setSelectionMenu(null)
    const clip = getScenarioClipboard()
    if (!clip || clip.nodes.length === 0) return
    // Pan-aware placement: same view → stack diagonally (+40 each paste); after a
    // pan or in another scenario → re-centre the group on the current view so it
    // never lands off-screen. The delta applies to every node's stored position,
    // preserving the group's internal layout.
    const rect = wrapperRef.current?.getBoundingClientRect()
    const viewCenter = rect
      ? screenToFlowPosition({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      : { x: 0, y: 0 }
    const delta = nextPasteDelta(getViewport(), viewCenter)
    const idMap = new Map<string, string>()
    let i = 0
    const stamp = Date.now()
    const newNodes: ScenarioNode[] = clip.nodes.map((n) => {
      const newId = `${stamp}-${i++}-${Math.random().toString(36).slice(2, 8)}`
      idMap.set(n.id, newId)
      const clonedNode: ScenarioNode = { ...n, id: newId, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } }
      nodeStore.current.set(newId, clonedNode)
      return clonedNode
    })
    const newEdges: ScenarioEdge[] = clip.edges.map((e) => {
      const ne: ScenarioEdge = {
        ...e,
        id: `e-${stamp}-${i++}-${Math.random().toString(36).slice(2, 8)}`,
        from: { ...e.from, nodeId: idMap.get(e.from.nodeId) ?? e.from.nodeId },
        to: { ...e.to, nodeId: idMap.get(e.to.nodeId) ?? e.to.nodeId }
      }
      edgeStore.current.set(ne.id, ne)
      return ne
    })
    const nextNodes = [
      ...nodesRef.current.map((n) => ({ ...n, selected: false })),
      ...newNodes.map((n) => ({ ...toFlowNode(n, handlers.current), selected: true }))
    ]
    const nextEdges = [...edgesRef.current, ...newEdges.map((e) => buildFlowEdge(e))]
    setNodes(nextNodes)
    setEdges(nextEdges)
    persist(nextNodes, nextEdges)
  }, [setNodes, setEdges, persist, buildFlowEdge, screenToFlowPosition, getViewport])

  // Clipboard / duplicate keyboard shortcuts — Ctrl on Win/Linux, Cmd on macOS
  // (both surface as ctrlKey/metaKey). Scoped to the ACTIVE scenario tab, like
  // Delete. Copy needs a selection; paste + duplicate are no-ops while the
  // scenario is locked (running/paused). Kept in its own effect (after the
  // callbacks are defined) so they can be real dependencies.
  useEffect(() => {
    if (!isActiveTab) return undefined
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || !!el.closest('.monaco-editor'))
      // Undo / redo first — the platform mapping lives in ECUI. Redo's
      // Ctrl+Shift+Z variant would be rejected by the no-shift guard below, so
      // it has to be handled ahead of the clipboard combos. Blocked while a run
      // holds the graph read-only, and while typing into a field.
      if (!typing && !lockedRef.current) {
        if (isUndoKeyEvent(e)) { e.preventDefault(); undo(); return }
        if (isRedoKeyEvent(e)) { e.preventDefault(); redo(); return }
      }
      if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey)) return
      const key = e.key.toLowerCase()
      if (key !== 'c' && key !== 'v' && key !== 'd') return
      if (typing) return
      const selectedIds = nodesRef.current.filter((n) => n.selected).map((n) => n.id)
      if (key === 'c') {
        if (selectedIds.length > 0) { e.preventDefault(); copyNodes(selectedIds) }
        return
      }
      if (lockedRef.current) return
      e.preventDefault()
      if (key === 'v') pasteNodes()
      else if (selectedIds.length > 1) duplicateNodes(selectedIds)
      else if (selectedIds.length === 1 && selectedIds[0] !== undefined) duplicateNode(selectedIds[0])
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [isActiveTab, copyNodes, pasteNodes, duplicateNodes, duplicateNode, undo, redo])

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
    if (lockedRef.current) return
    closeOverlays()
    const clientX = 'clientX' in event ? event.clientX : 0
    const clientY = 'clientY' in event ? event.clientY : 0
    // Screen coords for the ContextMenu (same convention as the node menu).
    setPalette({ x: clientX, y: clientY, flow: screenToFlowPosition({ x: clientX, y: clientY }) })
  }, [screenToFlowPosition, closeOverlays])

  // Right-click on an edge: select it (deselect the rest) + open the edge menu.
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault()
    event.stopPropagation()
    if (lockedRef.current) return
    closeOverlays()
    setEdges((curr) => curr.map((e) => (e.selected === (e.id === edge.id) ? e : { ...e, selected: e.id === edge.id })))
    setEdgeMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY })
  }, [setEdges, closeOverlays])

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
          const stroke = color ?? edgeColorForHandle(sc?.from.portId, port)
          return { ...e, style: { ...(e.style ?? {}), ...(stroke ? { stroke } : {}) } }
        })
        persist(n, next)
        return next
      })
      return n
    })
  }, [setNodes, setEdges, persist, derivedPortsOf])

  // Incoming data links (value/both output → data input) with their JSON-path
  // selector — feeds the empty/malformed-path validation rule. A runScenario's
  // outputs are derived, so merge them when classifying the source flow.
  // Node lookup from the persisted `scenario.nodes` (stable mid-drag), NOT the
  // live React Flow `nodes` — dragging a box gives `nodes` a fresh array each
  // tick, and this memo's output feeds `nodeErrors` → the error context → every
  // box. Link-ness depends only on kind / ports / config, never position.
  const dataLinks = useMemo<ScenarioDataLink[]>(() => {
    const byId = new Map(scenario.nodes.map((n) => [n.id, n]))
    const out: ScenarioDataLink[] = []
    for (const e of edges) {
      if (!e.source || !e.target || !e.sourceHandle || !e.targetHandle) continue
      const src = byId.get(e.source)
      const tgt = byId.get(e.target)
      if (!src || !tgt) continue
      // Object property inputs keep their own value field (no JSON-path
      // selector), so the empty/malformed-path rule doesn't apply to them.
      if (tgt.kind === 'object') continue
      const srcDerived = derivedPortsOf({ kind: src.kind, config: src.config })?.outputs ?? []
      const outFlow = outputPortFlow([...src.outputs, ...srcDerived], e.sourceHandle, src.kind)
      const inFlow = inputPortFlow(tgt.inputs, e.targetHandle, tgt.kind)
      if (!isDataLink(inFlow, outFlow)) continue
      const selector = typeof e.data?.['selector'] === 'string' ? e.data['selector'] : undefined
      out.push({ targetNodeId: e.target, targetPort: e.targetHandle, selector })
    }
    return out
  }, [edges, scenario.nodes, derivedPortsOf])

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
  // Validation + the error context read each node's id / kind / config — never
  // its x/y. Deriving them from the live React Flow `nodes` re-ran validation on
  // every drag tick (the moved node's new position makes a fresh `nodes` array)
  // and handed `ScenarioErrorsContext` a brand-new Map each tick, re-rendering
  // EVERY box for the whole drag. Derive from the persisted `scenario.nodes`
  // instead — the upstream source `nodes` is built from, which only changes
  // when something structural/config is committed (never mid-drag) — so a drag
  // leaves `validationNodes`, `nodeErrors`, and the context value referentially
  // stable and no box re-renders while one is being moved.
  const validationNodes = useMemo<ValidationNode[]>(
    () => scenario.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config })),
    [scenario.nodes]
  )
  const nodeErrors = useMemo(() => {
    const byNode = validateScenarioGraph(validationNodes, dataLinks, connectedTargets, t)
    const add = (id: string, error: ScenarioNodeError): void => {
      const list = byNode.get(id)
      if (list) list.push(error)
      else byNode.set(id, [error])
    }
    for (const n of validationNodes) {
      // A request / runScenario box is always created bound (palette or drag),
      // so an *unbound* box can't occur — only a *deleted* binding can, which
      // we flag as a safety net (incoherent state from an external delete).
      if (n.kind === 'httpRequest') {
        const requestId = typeof n.config['requestId'] === 'string' ? n.config['requestId'] : ''
        if (requestId) {
          const item = resolveBoundItem?.(requestId) ?? null
          if (!item || !isRequest(item)) add(n.id, { code: 'request-missing', message: t('scenario.validation.request.missing', 'The bound request no longer exists.') })
        }
      } else if (n.kind === 'runScenario') {
        const scenarioId = typeof n.config['scenarioId'] === 'string' ? n.config['scenarioId'] : ''
        if (scenarioId) {
          const sub = resolveScenario(scenarioId)
          if (!sub) {
            add(n.id, { code: 'scenario-missing', message: t('scenario.validation.runScenario.missing', 'The bound scenario no longer exists.') })
          }
        }
      }
    }
    return byNode
  }, [validationNodes, dataLinks, connectedTargets, resolveBoundItem, resolveScenario, t])
  // Flat list of every box error, with the box's display title, for the panel.
  const workflowErrors = useMemo<{ nodeId: string; title: string; error: ScenarioNodeError }[]>(() => {
    const meta = new Map(validationNodes.map((n) => [n.id, t(scenarioNodeMeta(n.kind).labelKey, scenarioNodeMeta(n.kind).defaultLabel)]))
    const out: { nodeId: string; title: string; error: ScenarioNodeError }[] = []
    for (const [nodeId, errs] of nodeErrors) {
      for (const error of errs) out.push({ nodeId, title: meta.get(nodeId) ?? nodeId, error })
    }
    return out
  }, [nodeErrors, validationNodes, t])

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
      ? computeRunScenarioOutputs(n, resolveBoundItem)
      : staticScenarioPreview(
          { id: n.id, kind: n.data.kind, config: cfg },
          nodes.map((x) => ({ id: x.id, kind: x.data.kind, config: x.data.config ?? {} })),
          staticEdges
        )
    // For an object / wait / waitUntil, also surface the wired non-static
    // properties so the inspector can fetch + inject (cf. wiredFetches).
    const wiredFetches = collectObjectWiredProps(n, nodes, edges)
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
    // Boxes the main-process engine can actually run on demand (cf.
    // `runScenarioNode` switch). The inspector uses this to swap its
    // "example data based on previous runs" info row for an inline
    // play-from-here button when the box has no result yet.
    const runnable = n.data.kind === 'httpRequest'
    // Bound-item navigation: a request / runScenario box can open its
    // backing item in a workbench tab from the inspector's top row.
    let openItemId: string | undefined
    let openItemKind: 'request' | 'scenario' | undefined
    if (n.data.kind === 'httpRequest') {
      const reqId = typeof cfg['requestId'] === 'string' ? cfg['requestId'] : undefined
      if (reqId) { openItemId = reqId; openItemKind = 'request' }
    } else if (n.data.kind === 'runScenario') {
      const scnId = typeof cfg['scenarioId'] === 'string' ? cfg['scenarioId'] : undefined
      if (scnId) { openItemId = scnId; openItemKind = 'scenario' }
    }
    // Synthetic preview from the request's imported documentation, used
    // when the box has no recent real run. Computed eagerly here because
    // the resolver is pure (no IO) — its identity changes only when the
    // tree mutates, so it's safe inside this memo.
    let syntheticPreview: SyntheticRequestPreview | null = null
    if (n.data.kind === 'httpRequest' && resolveSyntheticPreview) {
      const boundId = typeof cfg['requestId'] === 'string' ? cfg['requestId'] : null
      if (boundId) syntheticPreview = resolveSyntheticPreview(boundId)
    }
    return {
      id: n.id,
      title,
      titleBadge,
      ...(n.data.note ? { note: n.data.note } : {}),
      outputs,
      staticData,
      ...(wiredFetches.length > 0 ? { wiredFetches } : {}),
      ...(listOp ? { listOp } : {}),
      ...(n.data['running'] === true ? { running: true } : {}),
      ...(runnable ? { runnable: true } : {}),
      ...(syntheticPreview ? { syntheticPreview } : {}),
      ...(openItemId && openItemKind ? { openItemId, openItemKind } : {})
    }
  }, [nodes, edges, t, derivedPortsOf, resolveBoundItem, resolveSyntheticPreview])

  // Edges propagated to React Flow with a transient `data.debugToken` mirroring
  // any edge that received a token bump from the engine (`engine.edgeTokens`).
  // The token's identity (number value) drives the custom edge component's
  // single-shot travelling beam as data crosses the link during a run.
  const presentationalEdges = useMemo(() => {
    // Last-line guard against duplicate edge ids reaching React Flow: a
    // malformed scenario (two edges sharing an id) would otherwise spam
    // React's "two children with the same key" warning every render. The
    // seed effect heals the file, but other edge-sync effects re-read the
    // still-duplicated `scenario.edges`, so dedup here at the render choke
    // point keeps the warning gone until the heal round-trips to disk.
    const seen = new Set<string>()
    const uniqueEdges = edges.filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
    const engineEdgeTokens = engine.edgeTokens
    if (engineEdgeTokens.size === 0) return uniqueEdges
    return uniqueEdges.map((e) => {
      const engineTok = engineEdgeTokens.get(e.id)
      if (engineTok === undefined) return e
      return { ...e, data: { ...(e.data ?? {}), debugToken: engineTok } }
    })
  }, [edges, engine.edgeTokens])

  // Inject `data.running` for every node the engine reports as currently
  // running — `ScenarioNodeBoxBase` reacts to that flag to mount/unmount the
  // BorderBeam trail.
  const presentationalNodes = useMemo(() => {
    let mapped = nodes
    if (engine.runningNodeIds.size > 0) {
      mapped = mapped.map((n) =>
        engine.runningNodeIds.has(n.id) && n.data['running'] !== true
          ? { ...n, data: { ...n.data, running: true } }
          : n
      )
    }
    // Per-node debug state + the yellow frame. The yellow "just finished" frame
    // shows a box the engine completed since the last play, ONLY while paused (a
    // "where did I pause" cue) — and ALSO the box a breakpoint is paused at
    // (not executed yet). `breakpoint` drives the gutter glyph, `breakpointPaused`
    // the "reached" tooltip, `onToggleBreakpoint` the click. Unchanged nodes keep
    // their ref (no React Flow churn).
    const showFinished = engine.state === 'paused'
    mapped = mapped.map((n) => {
      const isBp = breakpointIds.has(n.id)
      const isBpPaused = engine.breakpointNodeId === n.id
      // Yellow frame: a box completed-while-paused OR the box we're paused right
      // before (breakpoint or step pre-stop). The tooltip is breakpoint-only.
      const want = (showFinished && engine.completedNodeIds.has(n.id)) || engine.pausedAtNodeId === n.id
      // `onToggleBreakpoint` is NOT compared/injected here: it lives in the base
      // node data (via the handlers ref, like onSetConfig) so it's already
      // stable. Injecting it per-render meant the base node (which never carries
      // it) always failed this check, rebuilding EVERY node's data on every
      // render — which gave React Flow a fresh node object for all nodes each
      // drag tick and re-rendered every box. Now only the few nodes whose
      // breakpoint / finished state actually changed get a new ref.
      const unchanged =
        (n.data.justFinished === true) === want &&
        (n.data.breakpoint === true) === isBp &&
        (n.data.breakpointPaused === true) === isBpPaused
      if (unchanged) return n
      return { ...n, data: { ...n.data, justFinished: want, breakpoint: isBp, breakpointPaused: isBpPaused } }
    })
    // Read-only while running: flag each node for the inert-body CSS and drop
    // the config / header-menu writers so no edit can commit even via keyboard.
    if (locked) {
      mapped = mapped.map((n) => {
        const data = { ...n.data, locked: true }
        delete data.onSetConfig
        delete data.onHeaderContextMenu
        return { ...n, data }
      })
    }
    // Flash the box a log row pointed at (the token retriggers the overlay).
    if (flash) {
      mapped = mapped.map((n) =>
        n.id === flash.nodeId ? { ...n, data: { ...n.data, flashToken: flash.seq } } : n
      )
    }
    return mapped
  }, [nodes, engine.runningNodeIds, engine.completedNodeIds, engine.breakpointNodeId, engine.pausedAtNodeId, engine.state, breakpointIds, locked, flash])

  // Wire-ports for the link-drag "Add" submenu — the port the link filter
  // computed for the (folded) request / sub-scenario kinds, when each is
  // flow-compatible with the dragged port. `const` so the `!== undefined`
  // narrowing flows into the menu `onClick` closures below.
  const linkReqWire = linkPalette?.entries.find((e) => e.kind === 'httpRequest')?.wirePort
  const linkScnWire = linkPalette?.entries.find((e) => e.kind === 'runScenario')?.wirePort

  // Variables in scope — declared by `setVariable` nodes and named `input`/param
  // nodes, each carrying the type it was declared with. Drives the value
  // selector's "Variables" menu (and lets a slot hide incompatible-typed ones).
  // Derive from the persisted `scenario.nodes` (stable mid-drag), NOT the live
  // React Flow `nodes`. Variable names/types are position-independent, so keying
  // on `nodes` recreated this array — hence the ScenarioVariablesContext value —
  // on every drag tick, re-rendering every box that hosts a TypedValueField.
  const scenarioVariables = useMemo<ScenarioVariable[]>(() => {
    const byName = new Map<string, ScenarioVariable>()
    for (const node of scenario.nodes) {
      const kind = node.kind
      if (kind === 'input') {
        // Every declared param of an input node is a scenario variable (its
        // value is published into the run store by `inputExecutor`) — so the
        // user can reference `{{param1}}` directly without a relay setVariable.
        for (const param of readInputParams(node.config)) {
          const name = param.name.trim()
          if (name === '') continue
          byName.set(name, { name, type: resolveValueTypeKind(normalizeValueType(param.valueType)) })
        }
        continue
      }
      if (kind !== 'setVariable') continue
      // setVariable stores the value under `value`; its declared type is that
      // value's kind.
      const config = node.config as { name?: unknown; value?: unknown }
      const name = config.name
      if (typeof name !== 'string' || name.trim() === '') continue
      byName.set(name, { name, type: resolveValueTypeKind(normalizeValueType(config.value)) })
    }
    return [...byName.values()]
  }, [scenario.nodes])

  // STABLE React Flow event handlers. React Flow's `NodeRenderer` + `NodeWrapper`
  // are `memo()`'d and receive `onNodeClick` (and friends) as props; passing a
  // fresh inline closure on every editor render — which happens on EVERY drag
  // tick — breaks that memo for ALL nodes, re-rendering every box on each
  // pointer move. Hoisting these to stable `useCallback`s lets the memo hold so
  // only the dragged node re-renders. (React Compiler would do this, but it
  // bails on this large component.)
  const closeAllMenus = useCallback(() => {
    setNodeMenu(null); setSelectionMenu(null); setMultiColorPicker(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null); setLinkPalette(null)
  }, [])
  const onPaneClickStable = useCallback(() => {
    setPalette(null); setNodeMenu(null); setSelectionMenu(null); setMultiColorPicker(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null)
    if (linkPaletteJustOpened.current) { linkPaletteJustOpened.current = false } else { setLinkPalette(null) }
    dismissOffCanvasPopovers()
  }, [])
  const onCanvasItemClickStable = useCallback((e: React.MouseEvent) => {
    if (!isCanvasOriginatedClick(e)) return
    setNodeMenu(null); setSelectionMenu(null); setMultiColorPicker(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null); setLinkPalette(null)
    dismissOffCanvasPopovers()
  }, [])
  const onMoveStartStable = useCallback(() => {
    setNodeMenu(null); setSelectionMenu(null); setMultiColorPicker(null); setPalette(null); setColorPickerNodeId(null); setEdgeMenu(null); setEdgeColorPicker(null); setLinkPalette(null)
  }, [])
  const onNodeDragStartStable = useCallback(() => { closeAllMenus() }, [closeAllMenus])
  const onMoveStable = useCallback((_e: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (projectUuid) setScenarioViewport(projectUuid, scenario.id, viewport)
  }, [projectUuid, scenario.id])
  const onSelectionContextMenuStable = useCallback((event: React.MouseEvent, selNodes: Node<NodeData>[]) => {
    // Right-click on a multi-selection (the box / a selected node's body) → the
    // bulk menu. The header's own onContextMenu covers header clicks.
    event.preventDefault()
    const ids = selNodes.map((n) => n.id)
    if (ids.length > 1) { setNodeMenu(null); setSelectionMenu({ x: event.clientX, y: event.clientY, nodeIds: ids }) }
  }, [])

  return (
    <ScenarioInternalsContext.Provider value={requestNodeInternals}>
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
      {locked && (
        <div data-testid="scenario-locked-banner" style={lockedBannerStyle}>
          <i className="codicon codicon-lock" aria-hidden="true" />
          {t('scenario.locked', 'Editing locked while the scenario is running')}
        </div>
      )}
      <ScenarioInspectorPanel
        scenarioId={scenario.id}
        errors={workflowErrors}
        errorBoxCount={nodeErrors.size}
        onFocusNode={onLogFocus}
        previewNode={previewNode}
        {...(onOpenItem ? { onOpenItem } : {})}
        engineState={engine.state}
        runLog={engine.runLog}
        onClearRunLog={engine.clearRunLog}
        onEngineRun={() => {
          // Always launch the run immediately — the scenario is "started" the
          // instant the user hits Play (badges + boxes beam). Any no-predecessor
          // `input` nodes run as live nodes that prompt the user; the renderer
          // groups those prompts into the "run parameters" modal below. This is
          // what lets a cancel route them to their `error` output.
          // Play arms the breakpoints (so a later Debug can honor them mid-run)
          // but runs with debug:false → straight through, ignoring them.
          void engine.start(scenario.id, {}, false, [...breakpointIds], false)
        }}
        onEnginePause={() => { void engine.pause() }}
        onEngineResume={() => { void engine.resume() }}
        onEngineStep={() => { void engine.step() }}
        onEngineStepStart={() => {
          // Launch armed in step mode (paused at the start), then advance one
          // step so the first action runs straight away.
          void (async () => {
            await engine.start(scenario.id, {}, true)
            await engine.step()
          })()
        }}
        onEngineStop={() => { void engine.stop() }}
        onEngineDebug={() => {
          // Debug run = same launch as Play, but with debug:true so it pauses
          // at the scenario's breakpoints.
          void engine.start(scenario.id, {}, false, [...breakpointIds], true)
        }}
        onEngineDebugContinue={() => {
          // Debug pressed on a live run (incl. a plain Play run): push the
          // current breakpoints, flip the run to debug mode, and continue — it
          // then stops at the next breakpoint.
          void engine.setEngineBreakpoints([...breakpointIds])
          void engine.enableDebug()
          if (engine.state === 'paused') void engine.resume()
        }}
        hasBreakpoints={breakpointIds.size > 0}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <ReactFlow
        nodes={presentationalNodes}
        edges={presentationalEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Only mount + measure the nodes inside the viewport — a scenario box is
        // a heavy DOM subtree, so rendering the whole graph at once froze the
        // editor for seconds on a large scenario. Off-screen boxes mount lazily.
        onlyRenderVisibleElements
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={validateConnection}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        deleteKeyCode={(!locked && isActiveTab) ? DELETE_KEYS : null}
        multiSelectionKeyCode={MULTI_SELECTION_KEYS}
        // React Flow's default `selectionKeyCode='Shift'` registers a
        // window-level `keydown` listener that calls `event.preventDefault()`
        // on EVERY Shift press (Shift is a modifier, so its internal
        // `preventDefault` guard always fires) — globally, for every tab. On
        // Linux that `preventDefault` on a bare modifier keydown wedges
        // Chromium's input pipeline into a composition-like state that
        // swallows the next printable character, so the first letter of every
        // capital (Shift + letter) is eaten in every text field on the page.
        // Disabling the Shift selection activator removes the global listener.
        // To keep rubber-band selection without a (modifier) keyboard key, it
        // moves onto the mouse: left-drag on the pane box-selects
        // (`selectionOnDrag`), and panning moves to the middle mouse button
        // (`panOnDrag={[1]}`) so left-drag is free. Click + Ctrl/Meta+click
        // single/multi-select still work; right-drag stays the context menu.
        selectionKeyCode={null}
        selectionOnDrag
        snapToGrid
        snapGrid={SNAP_GRID}
        panOnDrag={PAN_ON_DRAG}
        onPaneContextMenu={onPaneContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onSelectionContextMenu={onSelectionContextMenuStable}
        onPaneClick={onPaneClickStable}
        onNodeClick={onCanvasItemClickStable}
        onEdgeClick={onCanvasItemClickStable}
        onMoveStart={onMoveStartStable}
        onMove={onMoveStable}
        onNodeDragStart={onNodeDragStartStable}
        {...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true })}
        proOptions={PRO_OPTIONS}
      >
        {/* Unique pattern id per scenario: React Flow's Background derives its
            SVG <pattern> id from this, and with several scenario tabs mounted
            at once a shared id makes `url(#pattern-…)` resolve to the first
            (often a hidden 0×0 tab), leaving the visible grid blank. */}
        {/* `offset={GRID_SIZE}` cancels React Flow's default half-cell dot
            centering, so the dots sit on the cell CORNERS — i.e. exactly the
            multiples of `GRID_SIZE` that `snapGrid` snaps a box's top-left to.
            A snapped box then lands its top-left corner right on a dot. */}
        <Background id={scenario.id} gap={GRID_SIZE} offset={GRID_SIZE} />
        <Controls showInteractive={false}>
          {/* Minimap toggle sits at the bottom of the control stack — i.e. just
            * below the fit-to-view button. */}
          <ControlButton
            onClick={() => { setShowMinimap((v) => !v) }}
            title={t('scenario.minimap.toggle', 'Toggle minimap')}
            aria-label={t('scenario.minimap.toggle', 'Toggle minimap')}
            data-testid="scenario-minimap-toggle"
            data-active={showMinimap ? 'true' : 'false'}
          >
            <span className="codicon codicon-map" aria-hidden="true" />
          </ControlButton>
        </Controls>
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            className="scn-minimap"
            nodeColor={(n) => (typeof (n.data as { color?: unknown }).color === 'string' ? (n.data as { color: string }).color : '#a855f7')}
          />
        )}
      </ReactFlow>
      {/* One prompt for every pending input — up-front params (all pending at
        * run start) and mid-run inputs (pending when the flow reaches them)
        * surface through the same modal, driven by `engine.pendingInputs`. */}
      <ScenarioInputPrompt
        pendingInputs={engine.pendingInputs}
        onResolve={(requestId, value) => { void engine.resolveUserInput(requestId, value) }}
        onCancel={(requestIds) => { for (const id of requestIds) void engine.cancelUserInput(id) }}
      />
      {/* Persisted run-history overlay — opened by the tab-header button
        * (via the SCENARIO_RUN_HISTORY_OPEN event). Rendered here so its
        * backdrop scopes to the editor's relative wrapper (fills the tab),
        * not the small header cluster the button sits in. */}
      <ScenarioRunHistoryModal
        isOpen={historyOpen}
        onClose={() => { setHistoryOpen(false) }}
        scenarioId={scenario.id}
      />
      {palette && (
        <ContextMenu
          visible
          x={palette.x}
          y={palette.y}
          onRequestClose={() => { setPalette(null) }}
          data-testid="scenario-node-palette"
          items={[
            ...(hasScenarioClipboard()
              ? [
                { id: 'paste', label: t('scenario.node.menu.paste', 'Paste'), icon: 'copy', onClick: () => { pasteNodes() } },
                { id: 'paste-sep', isSeparator: true, label: '' }
              ]
              : []),
            ...buildScenarioPaletteItems({
              t,
              withAddSubmenu: onCreateChild !== undefined,
              pickNode: (kind) => () => { addNode(kind, palette.flow) },
              pickChild: (kind) => () => { addChildNode(kind as AddChildKind, palette.flow) }
            })
          ]}
        />
      )}
      {linkPalette && (
        <ContextMenu
          visible
          x={linkPalette.x}
          y={linkPalette.y}
          onRequestClose={() => { setLinkPalette(null) }}
          data-testid="scenario-link-palette"
          items={buildScenarioPaletteItems({
            t,
            withAddSubmenu: onCreateChild !== undefined,
            // Only the flow-compatible kinds the filter kept are offered; each
            // wires through the port it computed.
            pickNode: (kind) => {
              const e = linkPalette.entries.find((x) => x.kind === kind)
              return e ? () => { addLinkedNode(kind, e.wirePort) } : null
            },
            // Child request kinds wire through the request port the filter found;
            // the sub-scenario through its own. Either may be unavailable.
            pickChild: (kind) => kind === SCENARIO_ADD_SCENARIO_ENTRY.kind
              ? (linkScnWire !== undefined ? () => { addChildLinkedNode('scenario', linkScnWire) } : null)
              : (linkReqWire !== undefined ? () => { addChildLinkedNode(kind as AddChildKind, linkReqWire) } : null)
          })}
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
            { id: 'sepBp', label: '', isSeparator: true },
            {
              id: 'breakpoint',
              label: breakpointIds.has(nodeMenu.nodeId)
                ? t('scenario.breakpoint.remove', 'Remove breakpoint')
                : t('scenario.breakpoint.add', 'Add breakpoint'),
              icon: breakpointIds.has(nodeMenu.nodeId) ? 'circle-filled' : 'circle-outline',
              shortcut: t('scenario.breakpoint.shortcut', 'F9'),
              onClick: () => { onToggleBreakpoint(nodeMenu.nodeId) }
            },
            // Only actions with an `in` port can receive events, so only they
            // expose the AND/OR join toggle.
            ...(nodeStore.current.get(nodeMenu.nodeId)?.inputs.some((p) => p.id === 'in')
              ? [{
                  id: 'run-on-each',
                  label: t('scenario.node.menu.runOnEachEvent', 'Play on each event received'),
                  // `checked` renders the ✓ that shows the on/off state — no
                  // `icon` (MenuItem gives an icon precedence over the check).
                  checked: nodeStore.current.get(nodeMenu.nodeId)?.config['runOnEachEvent'] === true,
                  onClick: () => { toggleRunOnEachEvent(nodeMenu.nodeId) }
                } as ContextMenuItem]
              : []),
            { id: 'sep1', label: '', isSeparator: true },
            { id: 'copy', label: t('scenario.node.menu.copy', 'Copy'), icon: 'copy', shortcut: 'Ctrl+C', onClick: () => { copyNodes([nodeMenu.nodeId]) } },
            { id: 'duplicate', label: t('scenario.node.menu.duplicate', 'Duplicate'), icon: 'files', shortcut: 'Ctrl+D', onClick: () => { duplicateNode(nodeMenu.nodeId) } },
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
      {/* Bulk menu for a multi-selection right-click: change colour / delete,
        * applied to every selected box. */}
      {selectionMenu && (
        <ContextMenu
          visible
          x={selectionMenu.x}
          y={selectionMenu.y}
          onRequestClose={() => { setSelectionMenu(null) }}
          data-testid="scenario-selection-menu"
          items={[
            { id: 'color', label: t('scenario.node.menu.changeColor', 'Change colour'), icon: 'symbol-color', opensDialog: true, onClick: () => { setMultiColorPicker({ x: selectionMenu.x, y: selectionMenu.y, nodeIds: selectionMenu.nodeIds }); setSelectionMenu(null) } },
            { id: 'sel-sep-1', label: '', isSeparator: true },
            { id: 'copy', label: t('scenario.node.menu.copy', 'Copy'), icon: 'copy', shortcut: 'Ctrl+C', onClick: () => { copyNodes(selectionMenu.nodeIds) } },
            { id: 'duplicate', label: t('scenario.node.menu.duplicate', 'Duplicate'), icon: 'files', shortcut: 'Ctrl+D', onClick: () => { duplicateNodes(selectionMenu.nodeIds) } },
            { id: 'sel-sep-2', label: '', isSeparator: true },
            { id: 'delete', label: t('scenario.node.menu.delete', 'Delete'), icon: 'trash', shortcut: t('scenario.node.menu.deleteShortcut', 'Del'), onClick: () => { deleteNodes(selectionMenu.nodeIds) } }
          ]}
        />
      )}
      {multiColorPicker && (
        <div ref={multiColorAnchorRef} style={{ position: 'fixed', left: multiColorPicker.x, top: multiColorPicker.y, width: 0, height: 0, pointerEvents: 'none' }} />
      )}
      <Tooltip
        targetRef={multiColorAnchorRef}
        show={multiColorPicker !== null}
        repositionKey={multiColorPicker ? multiColorPicker.nodeIds.join(',') : null}
        data-testid="scenario-selection-color-picker-tooltip"
        placement="below"
        side="auto"
        content={
          <div onMouseDown={(e) => { e.stopPropagation() }} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ColorPicker
              value="#3b82f6"
              onChange={(color) => { if (multiColorPicker) setNodesColor(multiColorPicker.nodeIds, color) }}
              disableAlpha
              data-testid="scenario-selection-color-picker"
            />
            <Button
              secondary
              fullWidth
              icon="trash"
              onClick={() => { if (multiColorPicker) { setNodesColor(multiColorPicker.nodeIds, undefined); setMultiColorPicker(null) } }}
              options={{ ariaLabel: t('scenario.node.menu.resetColor', 'Reset colour'), title: t('scenario.node.menu.resetColor', 'Reset colour') }}
              data-testid="scenario-selection-color-reset"
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
      {/* Sub-scenario log preview — popped left of a run-log row whose emitter
        * lives in a sub-scenario. A cursor-anchored ECUI Tooltip (same pattern
        * as the edge colour picker) hosts the read-only graph, pan-zoomed +
        * flashing the box; the title links through to that scenario. */}
      {subLogPopover && (
        <div ref={subLogAnchorRef} style={{ position: 'fixed', left: subLogPopover.x, top: subLogPopover.y, width: 0, height: 0, pointerEvents: 'none' }} />
      )}
      <Tooltip
        targetRef={subLogAnchorRef}
        show={subLogPopover !== null}
        repositionKey={subLogPopover ? `${subLogPopover.nodeId}:${subLogPopover.token}` : null}
        data-testid="scenario-sublog-popover"
        placement="auto"
        side="left"
        content={subLogPopover && (
          <div data-scn-sublog-popover className="scn-sublog-popover" onMouseDown={(e) => { e.stopPropagation() }}>
            <Button
              externalLink
              icon={<Badge type="SCENARIO" />}
              onClick={() => { onOpenItem?.(subLogPopover.scenario.id); setSubLogPopover(null) }}
              data-testid="scenario-sublog-popover-title"
            >
              {subLogPopover.scenario.name}
            </Button>
            <div className="scn-sublog-popover-graph">
              <ScenarioGraphPreview
                scenario={subLogPopover.scenario}
                interactive
                panMode="classic"
                focusNode={{ nodeId: subLogPopover.nodeId, token: subLogPopover.token }}
                testId="scenario-sublog-popover-graph"
              />
            </div>
          </div>
        )}
      />
      <Modal
        title={t('scenario.node.menu.addNote', 'Add note')}
        isOpen={noteEditorNodeId !== null}
        onClose={() => { setNoteEditorNodeId(null) }}
        size="dialog"
        scopeToSelector=".restorm-workbench-tab"
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
    </ScenarioInternalsContext.Provider>
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
