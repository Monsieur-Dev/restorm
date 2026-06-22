import { describe, it, expect } from 'vitest'
import { pickExecutor } from './registry'
import { SCENARIO_KINDS } from '../../../shared/scenarioKindRegistry'

/**
 * Drift-guard (runtime side): the executor map stays a
 * main-only switch (it imports sockets / fs / gRPC / QuickJS), so it can't be
 * derived from the shared registry — but it MUST resolve an executor for every
 * registry kind. A new kind added to the registry without an executor case fails
 * here in CI (the catastrophic "no executor for kind" runtime error), rather
 * than only at the build's `assertNever` exhaustiveness check.
 */
describe('pickExecutor resolves an executor for every registry kind', () => {
  it.each(SCENARIO_KINDS)('%s has an executor', (kind) => {
    expect(typeof pickExecutor(kind)).toBe('function')
  })

  it('resolves the legacy `request` alias to the httpRequest executor', () => {
    expect(pickExecutor('request')).toBe(pickExecutor('httpRequest'))
  })

  it('throws for an unknown kind', () => {
    expect(() => pickExecutor('definitely-not-a-kind')).toThrow()
  })
})
