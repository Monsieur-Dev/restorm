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

/** Drive the executor with a sub-scenario result, returning the emitted ports. */
async function runEmissions(outputs: Record<string, unknown>): Promise<string[]> {
  const act = { nodeId: 'n', kind: 'runScenario', scope: [], inputs: {} } as never
  const ctx = {
    node: { id: 'n', kind: 'runScenario', config: { scenarioId: 's' }, inputs: [], outputs: [], position: { x: 0, y: 0 } },
    signal: new AbortController().signal,
    runSubScenario: () => Promise.resolve(outputs)
  } as never
  const res = (await runScenarioExecutor(act, ctx)) as { outputs: { port: string }[] }
  return res.outputs.map((o) => o.port)
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

describe('runScenarioExecutor — emissions', () => {
  it('emits result + one port per output, but NOT a `done` token (the universal Done port signals completion; emitting it here too double-fires chained runScenarios)', async () => {
    const ports = await runEmissions({ first: 'a', second: 2 })
    expect(ports).toEqual(['result', 'output:first', 'output:second'])
    expect(ports).not.toContain('done')
  })

  it('an output-less sub-scenario emits only `result` (completion still flows through the universal Done port)', async () => {
    expect(await runEmissions({})).toEqual(['result'])
  })
})
