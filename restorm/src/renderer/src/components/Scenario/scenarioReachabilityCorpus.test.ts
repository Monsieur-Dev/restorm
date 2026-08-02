import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve, basename } from 'path'
import { parse } from 'yaml'
import type { TFunction } from 'i18next'
import {
  validateScenarioGraph,
  type ValidationNode,
  type ScenarioGraphEdge
} from '../../../../shared/scenarioValidation'

/**
 * The "can this box ever run?" rule, run against every scenario the repo
 * ships.
 *
 * Those projects are valid by construction — they are the samples the app
 * opens and the e2e suite drives — so ANY box flagged here is over-breadth in
 * the rule, by definition. That makes this a falsifier rather than a
 * hand-written expectation: it keeps holding as the fixtures grow, and it
 * catches a rule that starts flagging real wiring without anyone having to
 * predict which shape would trip it.
 *
 * The rule blocks Play, so over-breadth is the expensive direction: a false
 * positive takes a runnable scenario away from the user.
 */

const t = ((_key: string, def: string) => def) as unknown as TFunction

const SAMPLES_DIR = resolve(__dirname, '../../../../../tests/e2e/samples')
const EXTRA_PROJECT_DIRS = [resolve(__dirname, '../../../../../Samples')]

interface RawNode { id?: unknown; kind?: unknown; config?: unknown }
interface RawEdge { from?: { nodeId?: unknown; portId?: unknown }; to?: { nodeId?: unknown; portId?: unknown } }
interface RawScenario { name?: unknown; nodes?: unknown; edges?: unknown }

/** Every `{ nodes, edges }` object anywhere in a parsed project file. */
function collectScenarios(value: unknown, out: RawScenario[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectScenarios(item, out)
    return
  }
  if (value === null || typeof value !== 'object') return
  const obj = value as Record<string, unknown>
  if (Array.isArray(obj['nodes']) && Array.isArray(obj['edges'])) out.push(obj as RawScenario)
  for (const child of Object.values(obj)) collectScenarios(child, out)
}

function projectFiles(): string[] {
  const files: string[] = []
  for (const dir of [SAMPLES_DIR, ...EXTRA_PROJECT_DIRS]) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      if (entry.endsWith('.restorm')) { files.push(full); continue }
      // One level of nesting — a project can live in its own folder.
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      for (const nested of readdirSync(full)) {
        if (nested.endsWith('.restorm')) files.push(join(full, nested))
      }
    }
  }
  return files.sort()
}

function toGraph(scenario: RawScenario): { nodes: ValidationNode[]; edges: ScenarioGraphEdge[] } {
  const nodes: ValidationNode[] = []
  for (const raw of (scenario.nodes as RawNode[] | undefined) ?? []) {
    if (typeof raw.id !== 'string') continue
    nodes.push({
      id: raw.id,
      kind: raw.kind as ValidationNode['kind'],
      config: (raw.config as Record<string, unknown> | undefined) ?? {}
    })
  }
  const edges: ScenarioGraphEdge[] = []
  for (const raw of (scenario.edges as RawEdge[] | undefined) ?? []) {
    const from = raw.from
    const to = raw.to
    if (from === undefined || to === undefined) continue
    if (typeof from.nodeId !== 'string' || typeof to.nodeId !== 'string' || typeof to.portId !== 'string') continue
    edges.push({ fromNodeId: from.nodeId, toNodeId: to.nodeId, toPortId: to.portId })
  }
  return { nodes, edges }
}

const REACHABILITY_CODES = new Set(['unreachable', 'unreachable-cycle'])

describe('the unreachable-box rule, against every scenario the repo ships', () => {
  const files = projectFiles()

  it('finds the sample projects (a silent empty corpus would prove nothing)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('flags nothing in any shipped scenario', () => {
    let scenarioCount = 0
    const flagged: string[] = []
    for (const file of files) {
      const scenarios: RawScenario[] = []
      collectScenarios(parse(readFileSync(file, 'utf-8')), scenarios)
      for (const scenario of scenarios) {
        scenarioCount += 1
        const { nodes, edges } = toGraph(scenario)
        if (nodes.length === 0) continue
        const byNode = validateScenarioGraph(nodes, [], new Set(), t, edges)
        for (const [nodeId, errors] of byNode) {
          for (const error of errors) {
            if (!REACHABILITY_CODES.has(error.code)) continue
            const kind = nodes.find((n) => n.id === nodeId)?.kind
            flagged.push(`${basename(file)} "${String(scenario.name)}" ${String(kind)}(${nodeId}) ${error.code}`)
          }
        }
      }
    }
    // Guard the guard: an accidentally-empty walk would make the assertion
    // below vacuously true.
    expect(scenarioCount).toBeGreaterThan(50)
    expect(flagged).toEqual([])
  })
})
