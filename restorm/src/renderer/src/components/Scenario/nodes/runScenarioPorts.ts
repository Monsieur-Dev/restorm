import type { Scenario } from '../../../../../shared/types/collections'

/**
 * Distinct, in-graph-order names declared by a sub-scenario's nodes of a kind —
 * `input` nodes give a `runScenario` call its inputs, `output` nodes its results
 * (the call signature is derived from the reference). Unnamed nodes can't become
 * a port so they're skipped; duplicate names collapse to one.
 */
export function namedParams(scenario: Scenario | null, kind: 'input' | 'output'): string[] {
  if (!scenario) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const node of scenario.nodes) {
    if (node.kind !== kind) continue
    const name = typeof node.config['name'] === 'string' ? node.config['name'].trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}
