import { describe, it, expect } from 'vitest'
import { SCENARIO_KIND_REGISTRY, SCENARIO_KINDS, REGISTRY, type ScenarioNodeKind } from './scenarioKindRegistry'
import { defaultPortsForKind } from './scenarioNodePorts'
import { acceptsInputEvent, hasErrorPort, hasDonePort, hasStaticPreview, STATIC_PREVIEW_KINDS } from './scenarioNodeCapabilities'
import { SCENARIO_KIND_DOCS } from './scenarioKindDocs'
import { SCENARIO_NODE_CATALOGUE } from '../renderer/src/components/Scenario/scenarioNodeCatalogue'

/**
 * Drift-guard: the scenario-kind registry is the single source
 * of truth, and every per-kind list the app derives from it must stay in
 * lockstep. These assertions fail in CI — not in review — the moment a kind is
 * added to (or dropped from) one layer but not the registry.
 */

const KINDS = Object.keys(SCENARIO_KIND_REGISTRY) as ScenarioNodeKind[]

describe('scenario kind registry — completeness per kind', () => {
  it.each(KINDS)('%s has a complete spec (ports, doc, catalogue meta, capabilities)', (kind) => {
    const spec = REGISTRY[kind]
    expect(spec, `${kind} missing from registry`).toBeTruthy()

    // Catalogue meta.
    expect(spec.labelKey, `${kind} labelKey`).toMatch(/\S/)
    expect(spec.defaultLabel, `${kind} defaultLabel`).toMatch(/\S/)
    expect(spec.icon, `${kind} icon`).toMatch(/\S/)
    expect(spec.category, `${kind} category`).toMatch(/\S/)

    // Ports — both arrays present (may be empty for a sink/source).
    expect(Array.isArray(spec.ports.inputs), `${kind} ports.inputs`).toBe(true)
    expect(Array.isArray(spec.ports.outputs), `${kind} ports.outputs`).toBe(true)

    // Doc — a non-empty one-line summary.
    expect(spec.doc.summary, `${kind} doc.summary`).toMatch(/\S/)

    // Derived ports never fall through to the generic FALLBACK: every kind's
    // ports resolve from its own registry entry. (A fallback would surface as a
    // single `out` output the registry never declares.)
    const derived = defaultPortsForKind(kind)
    expect(Array.isArray(derived.inputs)).toBe(true)
    expect(Array.isArray(derived.outputs)).toBe(true)
    const isFallback = derived.outputs.length === 1 && derived.outputs[0]?.id === 'out'
      && spec.ports.outputs.every((o) => o.id !== 'out')
    expect(isFallback, `${kind} resolved the generic FALLBACK ports`).toBe(false)

    // Capability accessors return a boolean for every kind (no undefined).
    expect(typeof acceptsInputEvent(kind), `${kind} acceptsInputEvent`).toBe('boolean')
    expect(typeof hasErrorPort(kind), `${kind} hasErrorPort`).toBe('boolean')
    expect(typeof hasDonePort(kind), `${kind} hasDonePort`).toBe('boolean')
    expect(typeof hasStaticPreview(kind), `${kind} hasStaticPreview`).toBe('boolean')

    // Docs record entry matches the registry doc (derived, same object).
    expect(SCENARIO_KIND_DOCS[kind]).toBe(spec.doc)
  })
})

describe('scenario kind registry — no orphans (derived lists ⊆/=== registry)', () => {
  const registryKeys = new Set<string>(KINDS)

  it('SCENARIO_KINDS === registry keys, in registry order', () => {
    expect(SCENARIO_KINDS).toEqual(KINDS)
  })

  it('the add-node catalogue equals the registry keys, in registry (display) order', () => {
    // ⊆ both ways = same set; order must match so palette grouping is unchanged.
    expect(SCENARIO_NODE_CATALOGUE.map((m) => m.kind)).toEqual(KINDS)
    for (const meta of SCENARIO_NODE_CATALOGUE) {
      expect(registryKeys.has(meta.kind), `catalogue kind ${meta.kind} not in registry`).toBe(true)
      const spec = REGISTRY[meta.kind]
      expect(meta.labelKey).toBe(spec.labelKey)
      expect(meta.defaultLabel).toBe(spec.defaultLabel)
      expect(meta.icon).toBe(spec.icon)
      expect(meta.category).toBe(spec.category)
    }
  })

  it('STATIC_PREVIEW_KINDS ⊆ registry keys and matches the staticPreview flag', () => {
    for (const k of STATIC_PREVIEW_KINDS) {
      expect(registryKeys.has(k), `static-preview kind ${k} not in registry`).toBe(true)
      expect(REGISTRY[k].staticPreview).toBe(true)
    }
    // and every staticPreview:true kind is in the set
    for (const k of KINDS) {
      if (REGISTRY[k].staticPreview === true) expect(STATIC_PREVIEW_KINDS.has(k)).toBe(true)
    }
  })

  it('the docs record has exactly the registry keys', () => {
    expect(new Set(Object.keys(SCENARIO_KIND_DOCS))).toEqual(registryKeys)
  })
})
