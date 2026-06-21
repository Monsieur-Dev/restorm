import { describe, it, expect } from 'vitest'
import type { ScenarioNodeKind } from './types/collections'
import { acceptsInputEvent, hasStaticPreview, hasErrorPort, hasDonePort, STATIC_PREVIEW_KINDS } from './scenarioNodeCapabilities'

describe('scenario node capabilities', () => {
  it('every kind accepts an input event (incl. the output sink)', () => {
    for (const k of ['if', 'comparator', 'object', 'log', 'httpRequest', 'forEach', 'arithmetic', 'output'] as ScenarioNodeKind[]) {
      expect(acceptsInputEvent(k), `${k} should accept an input event`).toBe(true)
    }
  })

  it('hasStaticPreview agrees with STATIC_PREVIEW_KINDS', () => {
    expect(hasStaticPreview('comparator')).toBe(true)
    expect(hasStaticPreview('httpRequest')).toBe(false)
    // The `output` sink is statically previewable (literal fallbacks + wired
    // sources), even though it has no outgoing port — its preview is what the
    // inspector and a parent runScenario's output suggestion read.
    expect(hasStaticPreview('output')).toBe(true)
    for (const k of STATIC_PREVIEW_KINDS) expect(hasStaticPreview(k)).toBe(true)
  })

  it('keeps execution-bound kinds out of the static-preview set', () => {
    for (const k of ['httpRequest', 'runScenario', 'forEach', 'for', 'log', 'assert'] as ScenarioNodeKind[]) {
      expect(STATIC_PREVIEW_KINDS.has(k), `${k} should not be static-previewable`).toBe(false)
    }
  })

  it('error port: default true, off for output / now / retry', () => {
    // `log` and `toast` DO carry one — they render Handlebars expressions that
    // can fail at runtime, and the failure routes to `error` (never silent).
    for (const k of ['if', 'httpRequest', 'arithmetic', 'comparator', 'log', 'toast'] as ScenarioNodeKind[]) {
      expect(hasErrorPort(k), `${k} should have an error port`).toBe(true)
    }
    for (const k of ['output', 'now', 'retry'] as ScenarioNodeKind[]) {
      expect(hasErrorPort(k), `${k} should have no error port`).toBe(false)
    }
  })

  it('done port: default true, off only for output', () => {
    for (const k of ['if', 'log', 'now', 'arithmetic', 'httpRequest'] as ScenarioNodeKind[]) {
      expect(hasDonePort(k), `${k} should have a done port`).toBe(true)
    }
    expect(hasDonePort('output')).toBe(false)
  })
})
