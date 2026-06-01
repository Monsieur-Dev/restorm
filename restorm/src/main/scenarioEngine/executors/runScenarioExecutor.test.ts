import { describe, it, expect } from 'vitest'
import { runScenarioExecutor } from './runScenarioExecutor'

/** Drive the executor with a captured `runSubScenario`, returning the params it
 * forwarded to the sub-scenario. */
async function runWith(config: Record<string, unknown>, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  let forwarded: Record<string, unknown> = {}
  const act = { nodeId: 'n', kind: 'runScenario', scope: [], inputs } as never
  const ctx = {
    node: { id: 'n', kind: 'runScenario', config, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    signal: new AbortController().signal,
    runSubScenario: (_sid: string, params: Record<string, unknown>) => { forwarded = params; return Promise.resolve({}) }
  } as never
  await runScenarioExecutor(act, ctx)
  return forwarded
}

describe('runScenarioExecutor — call-site param values', () => {
  it('fills UNWIRED params from config.paramValues, resolved by type', async () => {
    const params = await runWith(
      { scenarioId: 's', paramValues: { greeting: { type: 'string', value: 'hi' }, count: { type: 'numeric', value: 7 } } },
      {}
    )
    expect(params).toEqual({ greeting: 'hi', count: 7 })
  })

  it('a wired link wins over the inline value (param:<name> strips the prefix)', async () => {
    const params = await runWith(
      { scenarioId: 's', paramValues: { greeting: { type: 'string', value: 'inline' } } },
      { 'param:greeting': 'wired' }
    )
    expect(params).toEqual({ greeting: 'wired' })
  })

  it('ignores a malformed paramValues without throwing', async () => {
    const params = await runWith({ scenarioId: 's', paramValues: 'oops' }, { 'param:a': 1 })
    expect(params).toEqual({ a: 1 })
  })
})
