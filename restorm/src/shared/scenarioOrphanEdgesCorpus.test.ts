import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve, basename } from 'path'
import { parse } from 'yaml'
import { findOrphanScenarioEdges, type OrphanCheckNode, type ScenarioEdgeEndpoints } from './scenarioValidation'

/**
 * The orphan-edge predicate, run against every scenario the repo ships.
 *
 * Those projects are valid by construction — they are the samples the app opens
 * and the e2e suite drives — so ANY edge flagged here is over-breadth in the
 * predicate, by definition. That makes this a falsifier rather than a
 * hand-written expectation: it keeps holding as the fixtures grow, and it
 * catches a predicate that starts flagging real wiring (a mis-modelled dynamic
 * port, a capability handle forgotten) without anyone having to predict which
 * shape would trip it.
 *
 * The predicate REFUSES a run, so over-breadth is the expensive direction: a
 * false positive takes a runnable scenario away from the user headless / under
 * MCP.
 */

const SAMPLES_DIR = resolve(__dirname, '../../tests/e2e/samples')
const EXTRA_PROJECT_DIRS = [resolve(__dirname, '../../Samples')]

interface RawNode { id?: unknown; kind?: unknown; config?: unknown }
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

function toModel(scenario: RawScenario): { nodes: OrphanCheckNode[]; edges: ScenarioEdgeEndpoints[] } {
  const nodes: OrphanCheckNode[] = []
  for (const raw of (scenario.nodes as RawNode[] | undefined) ?? []) {
    if (typeof raw.id !== 'string') continue
    nodes.push({ id: raw.id, kind: raw.kind as OrphanCheckNode['kind'], config: (raw.config as Record<string, unknown> | undefined) ?? {} })
  }
  const edges = (scenario.edges as ScenarioEdgeEndpoints[] | undefined) ?? []
  return { nodes, edges }
}

describe('the orphan-edge predicate, against every scenario the repo ships', () => {
  const files = projectFiles()

  it('finds the sample projects (a silent empty corpus would prove nothing)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('flags no orphan edge in any shipped scenario', () => {
    let scenarioCount = 0
    let edgeCount = 0
    const flagged: string[] = []
    for (const file of files) {
      const scenarios: RawScenario[] = []
      collectScenarios(parse(readFileSync(file, 'utf-8')), scenarios)
      for (const scenario of scenarios) {
        scenarioCount += 1
        const model = toModel(scenario)
        if (model.nodes.length === 0) continue
        edgeCount += model.edges.length
        for (const orphan of findOrphanScenarioEdges(model)) {
          const kind = model.nodes.find((n) => n.id === orphan.nodeId)?.kind
          flagged.push(`${basename(file)} "${String(scenario.name)}" ${String(kind)}(${orphan.nodeId}) ${orphan.side}:${orphan.portId}`)
        }
      }
    }
    // Guard the guard: an accidentally-empty walk would make the assertion
    // below vacuously true.
    expect(scenarioCount).toBeGreaterThan(50)
    expect(edgeCount).toBeGreaterThan(300)
    expect(flagged).toEqual([])
  })
})
