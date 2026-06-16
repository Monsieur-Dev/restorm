import type { ScenarioNodeKind } from '../../../../shared/types/collections'

/**
 * Presentation metadata for the scenario node catalogue (epic §5). The
 * runtime/port contracts grow per-kind in later slices; this drives the
 * add-node palette + the node box header (label + codicon).
 */
/** Catalogue grouping — drives the separators in the add-node menu. */
export type ScenarioNodeCategory =
  | 'control' | 'composition' | 'lists' | 'loops' | 'time' | 'math' | 'compute' | 'dataFormats' | 'encoding' | 'utility'

/** Categories rendered as a nested submenu in the add-node menu + link palette
 * (label + icon), instead of a flat separator-delimited group. Keyed off the
 * catalogue category so a new kind joins its submenu automatically. */
export const SCENARIO_SUBMENU_CATEGORIES: Partial<Record<ScenarioNodeCategory, { labelKey: string; defaultLabel: string; icon: string }>> = {
  lists: { labelKey: 'scenario.menuGroups.lists', defaultLabel: 'Lists', icon: 'list-unordered' },
  loops: { labelKey: 'scenario.nodes.loops', defaultLabel: 'Loops', icon: 'sync' },
  time: { labelKey: 'scenario.menuGroups.time', defaultLabel: 'Timing', icon: 'watch' },
  math: { labelKey: 'scenario.menuGroups.math', defaultLabel: 'Math', icon: 'symbol-operator' },
  dataFormats: { labelKey: 'scenario.menuGroups.dataFormats', defaultLabel: 'Data formats', icon: 'file-code' },
  encoding: { labelKey: 'scenario.menuGroups.encoding', defaultLabel: 'Encoding', icon: 'lock' }
}

export interface ScenarioNodeKindMeta {
  kind: ScenarioNodeKind
  /** i18n key under `scenario.nodes.*`, falling back to `defaultLabel`. */
  labelKey: string
  defaultLabel: string
  /** Codicon glyph shown on the node header + palette entry. */
  icon: string
  /** Group the kind belongs to (separators in the add-node menu). */
  category: ScenarioNodeCategory
}

/** Ordered catalogue, grouped to mirror the epic's §5 sections. */
export const SCENARIO_NODE_CATALOGUE: ScenarioNodeKindMeta[] = [
  // Sources & control
  { kind: 'input', labelKey: 'scenario.nodes.input', defaultLabel: 'Input / Param', icon: 'symbol-parameter', category: 'control' },
  { kind: 'output', labelKey: 'scenario.nodes.output', defaultLabel: 'Output / Return', icon: 'export', category: 'control' },
  { kind: 'if', labelKey: 'scenario.nodes.if', defaultLabel: 'If', icon: 'git-compare', category: 'control' },
  { kind: 'switch', labelKey: 'scenario.nodes.switch', defaultLabel: 'Switch', icon: 'list-tree', category: 'control' },
  { kind: 'retry', labelKey: 'scenario.nodes.retry', defaultLabel: 'Retry', icon: 'refresh', category: 'control' },
  // Requests & composition
  { kind: 'httpRequest', labelKey: 'scenario.nodes.httpRequest', defaultLabel: 'HTTP Request', icon: 'globe', category: 'composition' },
  { kind: 'runScenario', labelKey: 'scenario.nodes.runScenario', defaultLabel: 'Run scenario', icon: 'circuit-board', category: 'composition' },
  { kind: 'socketioConnect', labelKey: 'scenario.nodes.socketioConnect', defaultLabel: 'Socket.IO connect', icon: 'plug', category: 'composition' },
  { kind: 'socketioSend', labelKey: 'scenario.nodes.socketioSend', defaultLabel: 'Socket.IO send', icon: 'arrow-up', category: 'composition' },
  { kind: 'socketioClose', labelKey: 'scenario.nodes.socketioClose', defaultLabel: 'Socket.IO close', icon: 'debug-disconnect', category: 'composition' },
  { kind: 'websocketConnect', labelKey: 'scenario.nodes.websocketConnect', defaultLabel: 'WebSocket connect', icon: 'plug', category: 'composition' },
  { kind: 'websocketSend', labelKey: 'scenario.nodes.websocketSend', defaultLabel: 'WebSocket send', icon: 'arrow-up', category: 'composition' },
  { kind: 'websocketClose', labelKey: 'scenario.nodes.websocketClose', defaultLabel: 'WebSocket close', icon: 'debug-disconnect', category: 'composition' },
  { kind: 'mqttConnect', labelKey: 'scenario.nodes.mqttConnect', defaultLabel: 'MQTT connect', icon: 'plug', category: 'composition' },
  { kind: 'mqttSend', labelKey: 'scenario.nodes.mqttSend', defaultLabel: 'MQTT publish', icon: 'arrow-up', category: 'composition' },
  { kind: 'mqttClose', labelKey: 'scenario.nodes.mqttClose', defaultLabel: 'MQTT close', icon: 'debug-disconnect', category: 'composition' },
  { kind: 'grpcConnect', labelKey: 'scenario.nodes.grpcConnect', defaultLabel: 'gRPC connect', icon: 'plug', category: 'composition' },
  { kind: 'grpcSend', labelKey: 'scenario.nodes.grpcSend', defaultLabel: 'gRPC send', icon: 'arrow-up', category: 'composition' },
  { kind: 'grpcClose', labelKey: 'scenario.nodes.grpcClose', defaultLabel: 'gRPC close', icon: 'debug-disconnect', category: 'composition' },
  // Lists (grouped into a "Lists" submenu)
  { kind: 'aggregate', labelKey: 'scenario.nodes.aggregate', defaultLabel: 'Aggregate', icon: 'combine', category: 'lists' },
  { kind: 'map', labelKey: 'scenario.nodes.map', defaultLabel: 'Map', icon: 'arrow-swap', category: 'lists' },
  { kind: 'filter', labelKey: 'scenario.nodes.filter', defaultLabel: 'Filter', icon: 'filter', category: 'lists' },
  { kind: 'addToList', labelKey: 'scenario.nodes.addToList', defaultLabel: 'Add to list', icon: 'diff-added', category: 'lists' },
  { kind: 'removeFromList', labelKey: 'scenario.nodes.removeFromList', defaultLabel: 'Remove from list', icon: 'diff-removed', category: 'lists' },
  { kind: 'listOp', labelKey: 'scenario.nodes.listOp', defaultLabel: 'List ops', icon: 'list-flat', category: 'lists' },
  // Loops (grouped into a "Loops" submenu)
  { kind: 'forEach', labelKey: 'scenario.nodes.forEach', defaultLabel: 'ForEach', icon: 'symbol-array', category: 'loops' },
  { kind: 'for', labelKey: 'scenario.nodes.for', defaultLabel: 'For', icon: 'list-ordered', category: 'loops' },
  { kind: 'while', labelKey: 'scenario.nodes.while', defaultLabel: 'While', icon: 'sync', category: 'loops' },
  { kind: 'doWhile', labelKey: 'scenario.nodes.doWhile', defaultLabel: 'Do…While', icon: 'debug-restart', category: 'loops' },
  // Time (grouped into a "Timing" submenu)
  { kind: 'wait', labelKey: 'scenario.nodes.wait', defaultLabel: 'Wait', icon: 'watch', category: 'time' },
  { kind: 'waitUntil', labelKey: 'scenario.nodes.waitUntil', defaultLabel: 'Wait until', icon: 'clock', category: 'time' },
  { kind: 'timer', labelKey: 'scenario.nodes.timer', defaultLabel: 'Timer', icon: 'pulse', category: 'time' },
  { kind: 'now', labelKey: 'scenario.nodes.now', defaultLabel: 'Now', icon: 'calendar', category: 'time' },
  { kind: 'datetime', labelKey: 'scenario.nodes.datetime', defaultLabel: 'Date math', icon: 'history', category: 'time' },
  // Math (grouped into a "Math" submenu)
  { kind: 'arithmetic', labelKey: 'scenario.nodes.arithmetic', defaultLabel: 'Arithmetic', icon: 'symbol-operator', category: 'math' },
  { kind: 'comparator', labelKey: 'scenario.nodes.comparator', defaultLabel: 'Comparator', icon: 'equals', category: 'math' },
  { kind: 'math', labelKey: 'scenario.nodes.math', defaultLabel: 'Math', icon: 'symbol-numeric', category: 'math' },
  // Compute & values
  { kind: 'boolean', labelKey: 'scenario.nodes.boolean', defaultLabel: 'Boolean', icon: 'symbol-boolean', category: 'compute' },
  { kind: 'object', labelKey: 'scenario.nodes.object', defaultLabel: 'Object', icon: 'symbol-namespace', category: 'compute' },
  { kind: 'objectOp', labelKey: 'scenario.nodes.objectOp', defaultLabel: 'Object ops', icon: 'symbol-object', category: 'compute' },
  { kind: 'setVariable', labelKey: 'scenario.nodes.setVariable', defaultLabel: 'Set variable', icon: 'symbol-variable', category: 'compute' },
  { kind: 'getVariable', labelKey: 'scenario.nodes.getVariable', defaultLabel: 'Get variable', icon: 'symbol-variable', category: 'compute' },
  { kind: 'transform', labelKey: 'scenario.nodes.transform', defaultLabel: 'Transform template', icon: 'symbol-string', category: 'compute' },
  { kind: 'code', labelKey: 'scenario.nodes.code', defaultLabel: 'Code (sandbox)', icon: 'code', category: 'compute' },
  { kind: 'cast', labelKey: 'scenario.nodes.cast', defaultLabel: 'Cast', icon: 'replace', category: 'compute' },
  { kind: 'regex', labelKey: 'scenario.nodes.regex', defaultLabel: 'Regex', icon: 'regex', category: 'compute' },
  // Data formats (grouped into a "Data formats" submenu)
  { kind: 'json', labelKey: 'scenario.nodes.json', defaultLabel: 'JSON', icon: 'json', category: 'dataFormats' },
  { kind: 'xml', labelKey: 'scenario.nodes.xml', defaultLabel: 'XML', icon: 'code', category: 'dataFormats' },
  { kind: 'yaml', labelKey: 'scenario.nodes.yaml', defaultLabel: 'YAML', icon: 'symbol-structure', category: 'dataFormats' },
  { kind: 'csv', labelKey: 'scenario.nodes.csv', defaultLabel: 'CSV', icon: 'table', category: 'dataFormats' },
  // Encoding (grouped into an "Encoding" submenu)
  { kind: 'crypto', labelKey: 'scenario.nodes.crypto', defaultLabel: 'Crypto', icon: 'lock', category: 'encoding' },
  { kind: 'jwt', labelKey: 'scenario.nodes.jwt', defaultLabel: 'JWT', icon: 'key', category: 'encoding' },
  { kind: 'url', labelKey: 'scenario.nodes.url', defaultLabel: 'URL', icon: 'link', category: 'encoding' },
  // Utilities
  { kind: 'random', labelKey: 'scenario.nodes.random', defaultLabel: 'Random', icon: 'wand', category: 'utility' },
  { kind: 'schema', labelKey: 'scenario.nodes.schema', defaultLabel: 'Schema validate', icon: 'checklist', category: 'utility' },
  { kind: 'readFile', labelKey: 'scenario.nodes.readFile', defaultLabel: 'Read file', icon: 'file', category: 'utility' },
  { kind: 'writeFile', labelKey: 'scenario.nodes.writeFile', defaultLabel: 'Write file', icon: 'save', category: 'utility' },
  { kind: 'log', labelKey: 'scenario.nodes.log', defaultLabel: 'Log', icon: 'output', category: 'utility' },
  { kind: 'assert', labelKey: 'scenario.nodes.assert', defaultLabel: 'Assert', icon: 'verified', category: 'utility' },
  { kind: 'throw', labelKey: 'scenario.nodes.throw', defaultLabel: 'Throw', icon: 'error', category: 'utility' }
]

const byKind = new Map(SCENARIO_NODE_CATALOGUE.map((m) => [m.kind, m]))

/** Catalogue metadata for a kind (falls back to a generic entry). */
export function scenarioNodeMeta(kind: ScenarioNodeKind): ScenarioNodeKindMeta {
  return byKind.get(kind) ?? { kind, labelKey: `scenario.nodes.${kind}`, defaultLabel: kind, icon: 'circle-outline', category: 'utility' }
}
