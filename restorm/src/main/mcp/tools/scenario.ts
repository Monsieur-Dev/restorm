/**
 * MCP tools for full programmatic control of a scenario graph — no UI
 * clicks needed. Create / move / update / delete boxes (nodes), connect and
 * disconnect their ports (edges), and read the graph back. Mutations apply to
 * the main-process `collectionStore` (source of truth), are broadcast to the
 * renderer (so an open editor repaints + the file autosaves).
 *
 * Execution (running a scenario or a single box) is wired separately, on the
 * runtime engine, in `scenarioEngineTools.ts` (`run_scenario`,
 * `get_scenario_run_status`, …) and `scenarioRun.ts` (`run_scenario_node`).
 */

import { z } from 'zod'
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import type { Scenario } from '../../../shared/models/Scenario'
import type { ScenarioNode, ScenarioEdge, ScenarioNodeKind, ScenarioPort } from '../../../shared/types/scenario'
import { defaultPortsForKind, isValidScenarioConnection, outputPortFlow, inputPortFlow, deriveRunScenarioPorts, socketioConnectEventPorts } from '../../../shared/scenarioNodePorts'
import { layoutScenarioGraph, SCENARIO_NODE_FALLBACK_WIDTH, SCENARIO_NODE_FALLBACK_HEIGHT } from '../../../shared/scenarioGraphLayout'
import { SCENARIO_KIND_DOCS, VALUE_TYPE_DOCS } from '../../../shared/scenarioKindDocs'
import { STATIC_PREVIEW_KINDS, staticScenarioPreview, singleDeepPath, singleTopLevelKey, portPreviewValue, expectsObjectInput, type StaticPreviewEdge } from '../../../shared/utils/scenarioStaticPreview'
import { broadcastTreeReplace } from './import'

const SCENARIO_KINDS = [
  'input', 'output', 'if', 'switch', 'httpRequest', 'runScenario',
  'socketioConnect', 'socketioSend', 'socketioClose',
  'websocketConnect', 'websocketSend', 'websocketClose',
  'mqttConnect', 'mqttSend', 'mqttClose',
  'grpcConnect', 'grpcSend', 'grpcClose', 'forEach', 'for', 'while', 'doWhile',
  'aggregate', 'map', 'filter', 'addToList', 'removeFromList', 'wait', 'waitUntil', 'now', 'timer', 'arithmetic', 'comparator', 'boolean', 'object',
  'setVariable', 'getVariable', 'transform', 'code', 'cast', 'regex', 'json', 'xml', 'yaml', 'crypto', 'jwt', 'datetime',
  'objectOp', 'url', 'random', 'listOp', 'csv', 'math', 'schema', 'readFile', 'writeFile', 'retry', 'log', 'assert', 'throw'
] as const

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Node rects (position + measured size) reported by an open editor, per
 * scenario id. Size isn't in the model (React Flow measures it), so the
 * renderer pushes it here for the read tools to expose — lets an agent lay
 * boxes out without overlap, no screenshots needed. */
interface NodeRect { x: number; y: number; width: number; height: number }
const layoutCache = new Map<string, Record<string, NodeRect>>()

/** Resolve a scenario by id (a `type: 'scenario'` tree item), or null. */
function findScenario(id: string): Scenario | null {
  const item = collectionStore.findById(id)
  if (!item || (item as { type?: string }).type !== 'scenario') return null
  return item as unknown as Scenario
}

/** A node's effective ports = its static ports plus, for a `runScenario`, the
 * ports derived from the bound sub-scenario's input/output nodes (re-derived
 * live, never persisted) — so authoring can wire those derived param/output
 * ports, matching the editor. */
function effectivePorts(node: ScenarioNode): { inputs: ScenarioPort[]; outputs: ScenarioPort[] } {
  if (node.kind === 'runScenario') {
    const subId = typeof node.config['scenarioId'] === 'string' ? node.config['scenarioId'] : undefined
    const sub = subId ? findScenario(subId) : null
    const derived = deriveRunScenarioPorts(sub as unknown as Parameters<typeof deriveRunScenarioPorts>[0])
    return { inputs: [...node.inputs, ...derived.inputs], outputs: [...node.outputs, ...derived.outputs] }
  }
  if (node.kind === 'socketioConnect') {
    // The listened-event ports are derived from `config.events` (switch-like),
    // so authoring can wire a specific event without them being persisted on the
    // node's `outputs` array.
    return { inputs: node.inputs, outputs: [...node.outputs, ...socketioConnectEventPorts(node.config)] }
  }
  if (node.kind === 'httpRequest' || node.kind === 'request') {
    // Each writable slot of the bound request (path param / header /
    // query param / body) is exposed as a derived input port so a link
    // can short-circuit its resolution. Port ids mirror the renderer's
    // RequestNodeBox: `pathParams:<key>`, `headers:<key>`,
    // `params:<key>`, `body`. The engine's httpRequest executor reads
    // these same ids.
    return { inputs: [...node.inputs, ...deriveRequestSlotPorts(node)], outputs: node.outputs }
  }
  return { inputs: node.inputs, outputs: node.outputs }
}

/** Derived input ports for an httpRequest node's writable slots. */
function deriveRequestSlotPorts(node: ScenarioNode): ScenarioPort[] {
  const requestId = typeof node.config['requestId'] === 'string' ? node.config['requestId'] : undefined
  if (!requestId) return []
  const req = collectionStore.findById(requestId) as { headers?: KV[]; params?: KV[]; pathParams?: KV[]; body?: unknown } | null
  if (!req) return []
  const ports: ScenarioPort[] = []
  const add = (prefix: 'pathParams' | 'headers' | 'params', kvs: KV[] | undefined): void => {
    for (const kv of kvs ?? []) {
      if (kv.enabled === false || !kv.key) continue
      ports.push({ id: `${prefix}:${kv.key}`, name: kv.key, dataType: 'any', flow: 'value' })
    }
  }
  add('pathParams', req.pathParams)
  add('headers', req.headers)
  add('params', req.params)
  if (req.body !== undefined && req.body !== null) {
    ports.push({ id: 'body', name: 'body', dataType: 'any', flow: 'value' })
  }
  return ports
}

interface KV { key: string; value?: unknown; enabled?: boolean }

/** Push the mutated scenario to any open editor + sidebar, then autosave. */
export function broadcastScenario(scenario: Scenario): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('mcp:scenario-updated', {
      scenarioId: scenario.id,
      nodes: scenario.nodes,
      edges: scenario.edges,
      name: scenario.name,
      params: scenario.params
    })
  }
  broadcastTreeReplace()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('file:autosave-trigger')
  }
}

/** Compact node view for list/get replies. Merges measured size (width/height)
 * from the open editor when available. */
function nodeView(n: ScenarioNode, rects?: Record<string, NodeRect>): Record<string, unknown> {
  const rect = rects?.[n.id]
  return {
    id: n.id,
    kind: n.kind,
    position: n.position,
    ...(rect ? { size: { width: rect.width, height: rect.height } } : {}),
    config: n.config,
    inputs: n.inputs.map((p) => ({ id: p.id, name: p.name, dataType: p.dataType, ...(p.role ? { role: p.role } : {}), ...(p.required ? { required: true } : {}) })),
    outputs: n.outputs.map((p) => ({ id: p.id, name: p.name, dataType: p.dataType, ...(p.role ? { role: p.role } : {}) })),
    ...(n.note ? { note: n.note } : {}),
    ...(n.color ? { color: n.color } : {}),
    ...(n.collapsed ? { collapsed: true } : {})
  }
}

/** Compose a self-describing record for one node kind: its purpose, its
 * default ports (id + name + flow class + role), and its config keys. */
function describeScenarioKind(kind: ScenarioNodeKind): Record<string, unknown> {
  const { inputs, outputs } = defaultPortsForKind(kind)
  const doc = SCENARIO_KIND_DOCS[kind]
  const inPort = (p: ScenarioPort): Record<string, unknown> => ({ id: p.id, name: p.name || p.id, flow: inputPortFlow(inputs, p.id, kind), ...(p.role ? { role: p.role } : {}) })
  const outPort = (p: ScenarioPort): Record<string, unknown> => ({ id: p.id, name: p.name || p.id, flow: outputPortFlow(outputs, p.id, kind), ...(p.role ? { role: p.role } : {}) })
  return {
    kind,
    summary: doc.summary,
    inputs: inputs.map(inPort),
    // `error` (both) and `done` (signal) are implicit on every box — drawn by
    // the editor, not in the model. `done` fires once the box AND its whole
    // downstream sub-graph have completed. Surface both so a client knows it
    // can wire failure handling + sequence after a sub-flow finishes.
    outputs: [...outputs.map(outPort), { id: 'error', name: 'error', flow: 'both' }, { id: 'done', name: 'done', flow: 'signal' }],
    ...(doc.config && Object.keys(doc.config).length > 0 ? { config: doc.config } : {})
  }
}

/** Lay out every node in a scenario with an ELK layered (left→right) pass,
 * mutating each node's position in place. Prefers the open editor's measured
 * rects (pushed into `layoutCache`); for an unopened scenario it estimates each
 * box from its port counts — so an agent can tidy a graph it just built without
 * the tab being open (the renderer re-runs the measured layout on open anyway).
 * Returns the number of nodes that actually moved. */
async function arrangeScenario(scenario: Scenario): Promise<number> {
  const rects = layoutCache.get(scenario.id)
  const inputNodes = scenario.nodes.map((n) => {
    const measured = rects?.[n.id]
    if (measured && measured.width > 0 && measured.height > 0) {
      return { id: n.id, width: measured.width, height: measured.height }
    }
    const { inputs, outputs } = effectivePorts(n)
    const rows = Math.max(inputs.length, outputs.length, 1)
    return { id: n.id, width: SCENARIO_NODE_FALLBACK_WIDTH, height: Math.max(SCENARIO_NODE_FALLBACK_HEIGHT, 56 + rows * 34) }
  })
  const inputEdges = scenario.edges.map((e) => ({ id: e.id, source: e.from.nodeId, target: e.to.nodeId }))
  const positions = await layoutScenarioGraph(inputNodes, inputEdges)
  let moved = 0
  for (const n of scenario.nodes) {
    const p = positions.get(n.id)
    if (p && (n.position.x !== p.x || n.position.y !== p.y)) { n.position = { x: p.x, y: p.y }; moved++ }
  }
  return moved
}

export function registerScenarioTools(mcp: McpService): void {
  mcp.registerTool(
    'describe_scenario_kinds',
    {
      titleKey: 'mcpToolTitles.describeScenarioKinds',
      title: 'Describe scenario node kinds',
      description:
        'Self-describing catalogue for authoring scenario graphs: for each node kind, its purpose (`summary`), its default ' +
        'input/output ports (`id`, `name`, `flow` = value | signal | both, and `role`), and its `config` keys. The implicit ' +
        '`error` output is included. The top-level `valueTypes` map documents every typed-value shape a `config` / `valueType` ' +
        'can carry (`{ type, … }` — string, numeric, boolean, null, list, variable, environment, enum, …). Call this BEFORE ' +
        'create_scenario_node so you wire ports + set config correctly. Pass `kind` to get one kind; omit for all.',
      inputSchema: {
        kind: z.enum(SCENARIO_KINDS).optional().describe('Limit to a single kind; omit for the full catalogue.')
      } as Record<string, unknown>
    },
    (args) => {
      const one = typeof args['kind'] === 'string' ? args['kind'] as ScenarioNodeKind : null
      const kinds: readonly ScenarioNodeKind[] = one ? [one] : (SCENARIO_KINDS as readonly ScenarioNodeKind[])
      // `valueTypes` is the same regardless of `kind` — it's the value-shape
      // reference an author needs to fill `config` / `valueType` correctly.
      return jsonReply({ kinds: kinds.map(describeScenarioKind), valueTypes: VALUE_TYPE_DOCS })
    }
  )

  // An open editor pushes its React-Flow-measured node rects here so the read
  // tools can report box sizes (size isn't persisted in the model).
  ipcMain.removeAllListeners('scenario:layout')
  ipcMain.on('scenario:layout', (_e, payload: { scenarioId?: string; rects?: Record<string, NodeRect> }) => {
    if (typeof payload.scenarioId === 'string' && payload.rects) {
      layoutCache.set(payload.scenarioId, payload.rects)
    }
  })

  mcp.registerTool(
    'get_scenario',
    {
      titleKey: 'mcpToolTitles.getScenario',
      title: 'Read a scenario graph',
      description:
        'Return the full scenario graph: `{ id, name, notes, tags, params, nodes[], edges[] }`. ' +
        'Each node carries `{ id, kind, position, config, inputs[], outputs[], note?, color?, collapsed? }`; ' +
        'each edge `{ id, from:{nodeId,portId}, to:{nodeId,portId}, selector?, color? }`. Node *size* is ' +
        'measured by the renderer and is not part of the model — `position` is the box top-left in graph coords.',
      inputSchema: { scenarioId: z.string().min(1).describe('Scenario id (a `type:scenario` tree item).') } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      return jsonReply({
        id: scenario.id,
        name: scenario.name,
        notes: scenario.notes,
        tags: scenario.tags,
        params: scenario.params,
        nodes: scenario.nodes.map((n) => nodeView(n, layoutCache.get(id))),
        edges: scenario.edges
      })
    }
  )

  mcp.registerTool(
    'update_scenario',
    {
      titleKey: 'mcpToolTitles.updateScenario',
      title: 'Update a scenario\'s metadata',
      description:
        'Patch a scenario\'s tree-level metadata: `name`, `notes`, and `tags` (tags REPLACE the list ' +
        'wholesale). The graph itself (nodes / edges / params) is edited via the authoring tools ' +
        '(`create_scenario_node`, `connect_scenario_nodes`, …), never here. Repaints an open editor ' +
        'tab + the sidebar and autosaves. To rename, you can also use `rename_item`. To delete, use `delete_item`.',
      inputSchema: {
        scenarioId: z.string().min(1).describe('Scenario id.'),
        name: z.string().min(1).optional().describe('New display name.'),
        notes: z.string().optional().describe('User notes (empty string clears).'),
        tags: z.array(z.string()).optional().describe('Replaces the tag list wholesale.')
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const patch: Partial<Scenario> = {}
      if (typeof args['name'] === 'string' && args['name'] !== '') patch.name = args['name']
      if (typeof args['notes'] === 'string') patch.notes = args['notes']
      if (Array.isArray(args['tags'])) patch.tags = (args['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
      const updated = collectionStore.updateScenario(id, patch)
      if (!updated) return errorReply(`updateScenario failed for ${id}`)
      broadcastScenario(updated as unknown as Scenario)
      return jsonReply({ id, name: updated.name, notes: updated.notes, tags: updated.tags })
    }
  )

  mcp.registerTool(
    'list_scenario_nodes',
    {
      titleKey: 'mcpToolTitles.listScenarioNodes',
      title: 'List a scenario\'s nodes',
      description:
        'List the boxes of a scenario with their kind, position and ports — a lighter view than ' +
        '`get_scenario` (no edges). Use the returned port ids with `connect_scenario_nodes`.',
      inputSchema: { scenarioId: z.string().min(1).describe('Scenario id.') } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      return jsonReply({ scenarioId: id, nodes: scenario.nodes.map((n) => nodeView(n, layoutCache.get(id))) })
    }
  )

  mcp.registerTool(
    'create_scenario_node',
    {
      titleKey: 'mcpToolTitles.createScenarioNode',
      title: 'Add a box to a scenario',
      description:
        'Create a node (box) in a scenario. `kind` is one of: ' + SCENARIO_KINDS.join(', ') + '. ' +
        '**Call `describe_scenario_kinds` first** for each kind\'s purpose, ports, and `config` keys. ' +
        'Default input/output ports for the kind are stamped automatically. `config` is the per-kind ' +
        'bag — e.g. an `httpRequest` node binds via `{ requestId, label }`, `runScenario` via `{ scenarioId, label }`. ' +
        '`x`/`y` are optional — omit them (or pass `arrange: true`) to let the layout place the box: with `arrange` the ' +
        'whole graph is re-laid out left→right after the box is added, so you can build a scenario without computing ' +
        'positions. Returns `{ nodeId, kind, position, inputs, outputs, arranged }`.',
      inputSchema: {
        scenarioId: z.string().min(1).describe('Scenario to add the node to.'),
        kind: z.enum(SCENARIO_KINDS).describe('Node kind.'),
        x: z.coerce.number().optional().describe('X position in graph coords (default 0; ignored when arrange=true).'),
        y: z.coerce.number().optional().describe('Y position in graph coords (default 0; ignored when arrange=true).'),
        arrange: z.boolean().optional().describe('Re-run the ELK left→right auto-layout over the whole scenario after adding the box (positions become automatic).'),
        config: z.record(z.string(), z.unknown()).optional().describe('Per-kind config bag.')
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const kind = args['kind'] as ScenarioNodeKind
      const x = typeof args['x'] === 'number' ? args['x'] : 0
      const y = typeof args['y'] === 'number' ? args['y'] : 0
      const config = (args['config'] && typeof args['config'] === 'object' && !Array.isArray(args['config']))
        ? args['config'] as Record<string, unknown>
        : {}
      const { inputs, outputs } = defaultPortsForKind(kind)
      const node: ScenarioNode = { id: randomUUID(), kind, config, inputs, outputs, position: { x, y } }
      scenario.nodes.push(node)
      const reply = (arranged: boolean): ReturnType<typeof jsonReply> =>
        jsonReply({ nodeId: node.id, kind, position: node.position, inputs, outputs, arranged })
      // Fast path stays synchronous (the layout is async); only `arrange`
      // returns a Promise — the MCP SDK awaits either.
      if (args['arrange'] === true) {
        return arrangeScenario(scenario).then(() => { broadcastScenario(scenario); return reply(true) })
      }
      broadcastScenario(scenario)
      return reply(false)
    }
  )

  mcp.registerTool(
    'arrange_scenario',
    {
      titleKey: 'mcpToolTitles.arrangeScenario',
      title: 'Auto-arrange a scenario',
      description:
        'Re-lay out an entire scenario with an ELK layered (left→right) pass so boxes never overlap and the flow reads ' +
        'in execution order — entry points on the left, downstream actions to the right. Uses the open editor\'s measured ' +
        'box sizes when the scenario is open, else estimates each box from its port count. Ideal right after building a ' +
        'graph node-by-node (every box defaulted to 0,0). Returns `{ scenarioId, moved }` (how many boxes were repositioned).',
      inputSchema: {
        scenarioId: z.string().min(1).describe('Scenario to auto-arrange.')
      } as Record<string, unknown>
    },
    async (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const moved = await arrangeScenario(scenario)
      broadcastScenario(scenario)
      return jsonReply({ scenarioId: id, moved })
    }
  )

  mcp.registerTool(
    'update_scenario_node',
    {
      titleKey: 'mcpToolTitles.updateScenarioNode',
      title: 'Update a scenario box',
      description:
        'Patch a node\'s properties. `config` is shallow-merged into the existing config (pass a key ' +
        'with `null` to delete it). `note` / `color` set the annotation + box colour (empty string clears). ' +
        '`collapsed` toggles the collapsed view. Use `x`/`y` to move (or `move_scenario_node`).',
      inputSchema: {
        scenarioId: z.string().min(1),
        nodeId: z.string().min(1),
        config: z.record(z.string(), z.unknown()).optional().describe('Shallow-merged into config; null value deletes the key.'),
        note: z.string().optional(),
        color: z.string().optional(),
        collapsed: z.boolean().optional(),
        x: z.coerce.number().optional(),
        y: z.coerce.number().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const nodeId = typeof args['nodeId'] === 'string' ? args['nodeId'] : ''
      const node = scenario.nodes.find((n) => n.id === nodeId)
      if (!node) return errorReply(`No node ${nodeId} in scenario ${id}`)
      if (args['config'] && typeof args['config'] === 'object' && !Array.isArray(args['config'])) {
        for (const [k, v] of Object.entries(args['config'] as Record<string, unknown>)) {
          if (v === null) Reflect.deleteProperty(node.config, k)
          else node.config[k] = v
        }
      }
      if (typeof args['note'] === 'string') { if (args['note'] === '') delete node.note; else node.note = args['note'] }
      if (typeof args['color'] === 'string') { if (args['color'] === '') delete node.color; else node.color = args['color'] }
      if (typeof args['collapsed'] === 'boolean') { if (args['collapsed']) node.collapsed = true; else delete node.collapsed }
      if (typeof args['x'] === 'number') node.position.x = args['x']
      if (typeof args['y'] === 'number') node.position.y = args['y']
      broadcastScenario(scenario)
      return jsonReply(nodeView(node))
    }
  )

  mcp.registerTool(
    'move_scenario_node',
    {
      titleKey: 'mcpToolTitles.moveScenarioNode',
      title: 'Move a scenario box',
      description: 'Set a node\'s position (top-left) in graph coords. Convenience over `update_scenario_node`.',
      inputSchema: {
        scenarioId: z.string().min(1),
        nodeId: z.string().min(1),
        x: z.coerce.number(),
        y: z.coerce.number()
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const nodeId = typeof args['nodeId'] === 'string' ? args['nodeId'] : ''
      const node = scenario.nodes.find((n) => n.id === nodeId)
      if (!node) return errorReply(`No node ${nodeId} in scenario ${id}`)
      node.position = { x: Number(args['x']), y: Number(args['y']) }
      broadcastScenario(scenario)
      return jsonReply({ nodeId, position: node.position })
    }
  )

  mcp.registerTool(
    'delete_scenario_node',
    {
      titleKey: 'mcpToolTitles.deleteScenarioNode',
      title: 'Delete a scenario box',
      description: 'Remove a node and every edge that touches it. Returns the removed node + edge ids.',
      inputSchema: {
        scenarioId: z.string().min(1),
        nodeId: z.string().min(1)
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const nodeId = typeof args['nodeId'] === 'string' ? args['nodeId'] : ''
      if (!scenario.nodes.some((n) => n.id === nodeId)) return errorReply(`No node ${nodeId} in scenario ${id}`)
      const removedEdges = scenario.edges.filter((e) => e.from.nodeId === nodeId || e.to.nodeId === nodeId).map((e) => e.id)
      scenario.nodes = scenario.nodes.filter((n) => n.id !== nodeId)
      scenario.edges = scenario.edges.filter((e) => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId)
      broadcastScenario(scenario)
      return jsonReply({ deletedNodeId: nodeId, deletedEdgeIds: removedEdges })
    }
  )

  mcp.registerTool(
    'connect_scenario_nodes',
    {
      titleKey: 'mcpToolTitles.connectScenarioNodes',
      title: 'Connect two scenario boxes',
      description:
        'Create an edge from an output port of one node to an input port of another. `fromPortId` must be ' +
        'an output of `fromNodeId` (or the implicit `error` port); `toPortId` must be an input of `toNodeId`. ' +
        'Returns `{ edgeId }`.',
      inputSchema: {
        scenarioId: z.string().min(1),
        fromNodeId: z.string().min(1),
        fromPortId: z.string().min(1).describe('Output port id of the source node (or "error").'),
        toNodeId: z.string().min(1),
        toPortId: z.string().min(1).describe('Input port id of the target node.'),
        selector: z.string().optional().describe('Optional JSON selector applied to the value in transit.'),
        color: z.string().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const fromNodeId = String(args['fromNodeId'])
      const toNodeId = String(args['toNodeId'])
      const fromPortId = String(args['fromPortId'])
      const toPortId = String(args['toPortId'])
      const fromNode = scenario.nodes.find((n) => n.id === fromNodeId)
      const toNode = scenario.nodes.find((n) => n.id === toNodeId)
      if (!fromNode) return errorReply(`No source node ${fromNodeId}`)
      if (!toNode) return errorReply(`No target node ${toNodeId}`)
      // Effective ports include a runScenario's ports derived from its sub-scenario.
      const fromPorts = effectivePorts(fromNode)
      const toPorts = effectivePorts(toNode)
      if (fromPortId !== 'error' && fromPortId !== 'done' && !fromPorts.outputs.some((p) => p.id === fromPortId)) {
        return errorReply(`${fromPortId} is not an output of ${fromNodeId} (outputs: ${fromPorts.outputs.map((p) => p.id).join(', ') || 'none'})`)
      }
      if (!toPorts.inputs.some((p) => p.id === toPortId)) {
        return errorReply(`${toPortId} is not an input of ${toNodeId} (inputs: ${toPorts.inputs.map((p) => p.id).join(', ') || 'none'})`)
      }
      if (!isValidScenarioConnection({ sourceKind: fromNode.kind, sourceOutputs: fromPorts.outputs, sourceHandle: fromPortId, targetKind: toNode.kind, targetInputs: toPorts.inputs, targetHandle: toPortId })) {
        const outF = outputPortFlow(fromPorts.outputs, fromPortId, fromNode.kind)
        const inF = inputPortFlow(toPorts.inputs, toPortId, toNode.kind)
        return errorReply(`incompatible link: ${fromPortId} is a "${outF}" output and ${toPortId} accepts "${inF}" only (a value output can't drive a header trigger; a signal output can't feed a data input).`)
      }
      // A non-header input accepts a single incoming link (the header launch
      // trigger `in` keeps MERGE — multiple allowed). Mirrors the editor rule.
      if (toPortId !== 'in' && scenario.edges.some((e) => e.to.nodeId === toNodeId && e.to.portId === toPortId)) {
        return errorReply(`${toPortId} of ${toNodeId} already has an incoming link — a non-header input accepts a single link; disconnect the existing one first.`)
      }
      // Mirror the editor's onConnect: when the caller hasn't pinned a
      // selector and the link is a data link from a box whose output is fully
      // determined by its config (`STATIC_PREVIEW_KINDS`), auto-fill the
      // selector when the source's preview narrows to a single primitive path
      // (e.g. `getVariable` → `{ timer: 100 }` → `"timer"`).
      let autoSelector: string | undefined
      const explicitSelector = typeof args['selector'] === 'string' ? args['selector'] : undefined
      if (explicitSelector === undefined) {
        const outFlow = outputPortFlow(fromPorts.outputs, fromPortId, fromNode.kind)
        const inFlow = inputPortFlow(toPorts.inputs, toPortId, toNode.kind)
        if (inFlow === 'value' && outFlow !== 'signal') {
          // Deduce the selector from the PREVIEW VALUE AT THE WIRED PORT, exactly
          // like the editor's onConnect (ScenarioEditorView). `portPreviewValue`
          // unwraps a single-output box's port-map — a bare `math`/`arithmetic`
          // result is `16`, not `{ result: 16 }` — so a primitive output deduces
          // identity `.`, not the port name. (The earlier code ran the path
          // deduction on the whole port-map, so `{ result: 16 }` wrongly yielded
          // the selector `result`, which resolved to `undefined` at runtime.) A
          // runtime-only source (httpRequest response, forEach `each`, …) has no
          // static preview → identity `.`.
          let preview: Record<string, unknown> | null = null
          if (STATIC_PREVIEW_KINDS.has(fromNode.kind)) {
            const previewNodes = scenario.nodes.map((n) => ({ id: n.id, kind: n.kind, config: n.config }))
            const previewEdges: StaticPreviewEdge[] = scenario.edges.map((e) => ({
              from: e.from,
              to: e.to,
              ...(e.selector !== undefined ? { selector: e.selector } : {})
            }))
            preview = staticScenarioPreview({ id: fromNode.id, kind: fromNode.kind, config: fromNode.config }, previewNodes, previewEdges)
          }
          const pv = preview ? portPreviewValue(preview, fromPortId, fromNode.kind) : null
          autoSelector = (expectsObjectInput(toNode.kind, toPortId)
            ? (pv ? singleTopLevelKey(pv) : null)
            : (pv ? singleDeepPath(pv) : null)) ?? '.'
        }
      }
      const edge: ScenarioEdge = {
        id: randomUUID(),
        from: { nodeId: fromNodeId, portId: fromPortId },
        to: { nodeId: toNodeId, portId: toPortId },
        ...(explicitSelector !== undefined ? { selector: explicitSelector } : autoSelector !== undefined ? { selector: autoSelector } : {}),
        ...(typeof args['color'] === 'string' ? { color: args['color'] } : {})
      }
      scenario.edges.push(edge)
      broadcastScenario(scenario)
      return jsonReply({ edgeId: edge.id, from: edge.from, to: edge.to, ...(edge.selector !== undefined ? { selector: edge.selector } : {}) })
    }
  )

  mcp.registerTool(
    'disconnect_scenario_nodes',
    {
      titleKey: 'mcpToolTitles.disconnectScenarioNodes',
      title: 'Remove a scenario edge',
      description: 'Delete an edge by its id (from `get_scenario`). Returns the removed edge id.',
      inputSchema: {
        scenarioId: z.string().min(1),
        edgeId: z.string().min(1)
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const edgeId = typeof args['edgeId'] === 'string' ? args['edgeId'] : ''
      if (!scenario.edges.some((e) => e.id === edgeId)) return errorReply(`No edge ${edgeId} in scenario ${id}`)
      scenario.edges = scenario.edges.filter((e) => e.id !== edgeId)
      broadcastScenario(scenario)
      return jsonReply({ deletedEdgeId: edgeId })
    }
  )

  mcp.registerTool(
    'set_edge_selector',
    {
      titleKey: 'mcpToolTitles.setEdgeSelector',
      title: 'Set or clear an edge selector',
      description:
        'Set the JSON selector applied to the value as it flows along an edge (e.g. ' +
        '`data.cooldown.total_seconds`), reshaping it in transit. Pass an empty string to clear it ' +
        '(identity passthrough). Edge ids come from `get_scenario`. This is the standalone editor for an ' +
        'EXISTING edge — `connect_scenario_nodes` already takes a `selector` at creation time. Returns the edge.',
      inputSchema: {
        scenarioId: z.string().min(1),
        edgeId: z.string().min(1).describe('Edge id (from get_scenario).'),
        selector: z.string().describe('JSON selector to apply; empty string clears it.')
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const edgeId = typeof args['edgeId'] === 'string' ? args['edgeId'] : ''
      const edge = scenario.edges.find((e) => e.id === edgeId)
      if (!edge) return errorReply(`No edge ${edgeId} in scenario ${id}`)
      const selector = typeof args['selector'] === 'string' ? args['selector'] : ''
      if (selector === '') delete edge.selector
      else edge.selector = selector
      broadcastScenario(scenario)
      return jsonReply({ edgeId: edge.id, from: edge.from, to: edge.to, ...(edge.selector !== undefined ? { selector: edge.selector } : {}) })
    }
  )

  mcp.registerTool(
    'define_param',
    {
      titleKey: 'mcpToolTitles.defineParam',
      title: 'Define a scenario input parameter',
      description:
        'Declare a named run parameter by adding an `input` node — the engine seeds `run_scenario` params ' +
        'into input nodes BY NAME (there is no separate param store, so a param IS an input node). ' +
        '`valueType` is the typed default `{ type, value }` used when no value is supplied; `required` marks ' +
        'it required for calling scenarios (`runScenario`). Convenience over `create_scenario_node` with ' +
        '`kind: "input"`. Returns the created node.',
      inputSchema: {
        scenarioId: z.string().min(1),
        name: z.string().min(1).describe('Param name — the key callers pass to run_scenario.'),
        valueType: z.record(z.string(), z.unknown()).optional().describe('Typed default `{ type, value }` used when no value is supplied.'),
        required: z.boolean().optional().describe('Mark the param required for calling scenarios (runScenario).'),
        x: z.coerce.number().optional().describe('X position in graph coords (default 0).'),
        y: z.coerce.number().optional().describe('Y position in graph coords (default 0).')
      } as Record<string, unknown>
    },
    (args) => {
      const id = typeof args['scenarioId'] === 'string' ? args['scenarioId'] : ''
      const scenario = findScenario(id)
      if (!scenario) return errorReply(`No scenario with id ${id}`)
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (name === '') return errorReply('name is required')
      const config: Record<string, unknown> = { name }
      if (args['valueType'] && typeof args['valueType'] === 'object' && !Array.isArray(args['valueType'])) {
        config['valueType'] = args['valueType']
      }
      if (args['required'] === true) config['required'] = true
      const x = typeof args['x'] === 'number' ? args['x'] : 0
      const y = typeof args['y'] === 'number' ? args['y'] : 0
      const { inputs, outputs } = defaultPortsForKind('input')
      const node: ScenarioNode = { id: randomUUID(), kind: 'input', config, inputs, outputs, position: { x, y } }
      scenario.nodes.push(node)
      broadcastScenario(scenario)
      return jsonReply({ nodeId: node.id, kind: 'input', name, position: node.position })
    }
  )
}
