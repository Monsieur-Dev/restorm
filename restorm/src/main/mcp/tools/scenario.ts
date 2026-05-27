/**
 * MCP tools for full programmatic control of a scenario graph — no UI
 * clicks needed. Create / move / update / delete boxes (nodes), connect and
 * disconnect their ports (edges), and read the graph back. Mutations apply to
 * the main-process `collectionStore` (source of truth), are broadcast to the
 * renderer (so an open editor repaints + the file autosaves).
 *
 * Execution (`run` a box) waits on the scenario runtime engine and is not wired
 * here yet.
 */

import { z } from 'zod'
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import type { Scenario } from '../../../shared/models/Scenario'
import type { ScenarioNode, ScenarioEdge, ScenarioNodeKind } from '../../../shared/types/scenario'
import { defaultPortsForKind, isValidScenarioConnection, outputPortFlow, inputPortFlow } from '../../../shared/scenarioNodePorts'
import { broadcastTreeReplace } from './import'

const SCENARIO_KINDS = [
  'input', 'output', 'if', 'switch', 'httpRequest', 'runScenario', 'forEach', 'aggregate', 'map',
  'filter', 'wait', 'waitUntil', 'now', 'arithmetic', 'comparator', 'boolean', 'object',
  'setVariable', 'getVariable', 'transform', 'log', 'assert'
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

/** Push the mutated scenario to any open editor + sidebar, then autosave. */
function broadcastScenario(scenario: Scenario): void {
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

export function registerScenarioTools(mcp: McpService): void {
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
    'list_scenario_nodes',
    {
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
      title: 'Add a box to a scenario',
      description:
        'Create a node (box) in a scenario. `kind` is one of: ' + SCENARIO_KINDS.join(', ') + '. ' +
        'Default input/output ports for the kind are stamped automatically. `config` is the per-kind ' +
        'bag — e.g. an `httpRequest` node binds via `{ requestId, label }`, `runScenario` via `{ scenarioId, label }`. ' +
        'Returns `{ nodeId, kind, position, inputs, outputs }`.',
      inputSchema: {
        scenarioId: z.string().min(1).describe('Scenario to add the node to.'),
        kind: z.enum(SCENARIO_KINDS).describe('Node kind.'),
        x: z.coerce.number().optional().describe('X position in graph coords (default 0).'),
        y: z.coerce.number().optional().describe('Y position in graph coords (default 0).'),
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
      broadcastScenario(scenario)
      return jsonReply({ nodeId: node.id, kind, position: node.position, inputs, outputs })
    }
  )

  mcp.registerTool(
    'update_scenario_node',
    {
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
      if (fromPortId !== 'error' && !fromNode.outputs.some((p) => p.id === fromPortId)) {
        return errorReply(`${fromPortId} is not an output of ${fromNodeId} (outputs: ${fromNode.outputs.map((p) => p.id).join(', ') || 'none'})`)
      }
      if (!toNode.inputs.some((p) => p.id === toPortId)) {
        return errorReply(`${toPortId} is not an input of ${toNodeId} (inputs: ${toNode.inputs.map((p) => p.id).join(', ') || 'none'})`)
      }
      if (!isValidScenarioConnection({ sourceKind: fromNode.kind, sourceOutputs: fromNode.outputs, sourceHandle: fromPortId, targetKind: toNode.kind, targetInputs: toNode.inputs, targetHandle: toPortId })) {
        const outF = outputPortFlow(fromNode.outputs, fromPortId, fromNode.kind)
        const inF = inputPortFlow(toNode.inputs, toPortId, toNode.kind)
        return errorReply(`incompatible link: ${fromPortId} is a "${outF}" output and ${toPortId} accepts "${inF}" only (a value output can't drive a header trigger; a signal output can't feed a data input).`)
      }
      // A non-header input accepts a single incoming link (the header launch
      // trigger `in` keeps MERGE — multiple allowed). Mirrors the editor rule.
      if (toPortId !== 'in' && scenario.edges.some((e) => e.to.nodeId === toNodeId && e.to.portId === toPortId)) {
        return errorReply(`${toPortId} of ${toNodeId} already has an incoming link — a non-header input accepts a single link; disconnect the existing one first.`)
      }
      const edge: ScenarioEdge = {
        id: randomUUID(),
        from: { nodeId: fromNodeId, portId: fromPortId },
        to: { nodeId: toNodeId, portId: toPortId },
        ...(typeof args['selector'] === 'string' ? { selector: args['selector'] } : {}),
        ...(typeof args['color'] === 'string' ? { color: args['color'] } : {})
      }
      scenario.edges.push(edge)
      broadcastScenario(scenario)
      return jsonReply({ edgeId: edge.id, from: edge.from, to: edge.to })
    }
  )

  mcp.registerTool(
    'disconnect_scenario_nodes',
    {
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
}
