import { describe, it, expect } from 'vitest'
import { SCENARIO_KIND_DOCS } from './scenarioKindDocs'
import { defaultPortsForKind } from './scenarioNodePorts'
import type { ScenarioNodeKind } from './types/scenario'

/**
 * Guards the MCP discoverability contract behind `describe_scenario_kinds`:
 * every node kind must carry a non-empty purpose, and the loop kinds must
 * expose the ports a client needs to wire them. The `Record` is already
 * exhaustive at the type level — this checks the content at runtime.
 */
describe('scenario kind docs (describe_scenario_kinds source)', () => {
  const kinds = Object.keys(SCENARIO_KIND_DOCS) as ScenarioNodeKind[]

  it('documents a non-empty summary for every kind', () => {
    for (const k of kinds) {
      expect(SCENARIO_KIND_DOCS[k].summary.trim().length, `summary for ${k}`).toBeGreaterThan(0)
    }
  })

  it('exposes ports + a doc for each loop kind', () => {
    for (const k of ['forEach', 'for', 'while', 'doWhile'] as ScenarioNodeKind[]) {
      const { inputs, outputs } = defaultPortsForKind(k)
      expect(inputs.length + outputs.length, `ports for ${k}`).toBeGreaterThan(0)
      expect(SCENARIO_KIND_DOCS[k], `doc for ${k}`).toBeDefined()
    }
  })

  it('keeps config-key descriptions non-empty when present', () => {
    for (const k of kinds) {
      const cfg = SCENARIO_KIND_DOCS[k].config
      if (!cfg) continue
      for (const [key, desc] of Object.entries(cfg)) {
        expect(desc.trim().length, `${k}.config.${key}`).toBeGreaterThan(0)
      }
    }
  })
})
