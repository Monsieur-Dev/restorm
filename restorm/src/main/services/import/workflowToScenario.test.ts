import { describe, it, expect } from 'vitest'
import { workflowToScenario, type WorkflowRequestStep } from './workflowToScenario'
import { toScriptContext } from '../../scenarioEngine/executors/codeExecutor'

const step = (over: Partial<WorkflowRequestStep> & { requestId: string }): WorkflowRequestStep => ({
  name: over.name ?? over.requestId,
  source: over.source ?? 'postman',
  ...over
})

describe('workflowToScenario', () => {
  it('emits a pre → http → post chain with verbatim scripts + scriptMode markers', () => {
    const scn = workflowToScenario({
      id: 's1',
      name: 'Login flow',
      steps: [step({ requestId: 'r1', name: 'Login', prerequest: 'pm.environment.set("t", 1)', postresponse: 'pm.test("ok", () => {})' })]
    })
    expect(scn.type).toBe('scenario')
    const byId = Object.fromEntries(scn.nodes.map((n) => [n.id, n]))
    expect(byId['r1:pre']).toMatchObject({ kind: 'code', config: { language: 'javascript', code: 'pm.environment.set("t", 1)', scriptMode: 'postman-prerequest' } })
    expect(byId['r1:http']).toMatchObject({ kind: 'httpRequest', config: { requestId: 'r1', label: 'Login' } })
    expect(byId['r1:post']).toMatchObject({ kind: 'code', config: { scriptMode: 'postman-postresponse' } })
    // pre runs before the request; the request's response feeds the post script.
    expect(scn.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { nodeId: 'r1:pre', portId: 'done' }, to: { nodeId: 'r1:http', portId: 'in' } }),
      expect.objectContaining({ from: { nodeId: 'r1:http', portId: 'response' }, to: { nodeId: 'r1:post', portId: 'value' }, selector: '.' })
    ]))
  })

  it('chains consecutive requests in execution order (tail.done → head.in)', () => {
    const scn = workflowToScenario({
      id: 's2',
      name: 'Seq',
      steps: [
        step({ requestId: 'a', postresponse: 'pm.test("a", () => {})' }),
        step({ requestId: 'b', prerequest: 'pm.variables.set("x", 1)' }),
        step({ requestId: 'c' })
      ]
    })
    // a ends at its post node; b starts at its pre node; c is bare http.
    const chains = scn.edges.filter((e) => e.id.endsWith(':chain')).map((e) => [e.from.nodeId, e.from.portId, e.to.nodeId, e.to.portId])
    expect(chains).toEqual([
      ['a:post', 'done', 'b:pre', 'in'],
      ['b:http', 'done', 'c:http', 'in']
    ])
    // No node for absent scripts.
    expect(scn.nodes.find((n) => n.id === 'a:pre')).toBeUndefined()
    expect(scn.nodes.find((n) => n.id === 'c:post')).toBeUndefined()
  })

  it('imports a script-free collection as bare httpRequest nodes', () => {
    const scn = workflowToScenario({ id: 's3', name: 'Plain', steps: [step({ requestId: 'x' }), step({ requestId: 'y' })] })
    expect(scn.nodes.map((n) => n.kind)).toEqual(['httpRequest', 'httpRequest'])
    expect(scn.edges).toEqual([expect.objectContaining({ from: { nodeId: 'x:http', portId: 'done' }, to: { nodeId: 'y:http', portId: 'in' } })])
  })

  it('marks Bruno scripts with the bru-* scriptMode', () => {
    const scn = workflowToScenario({ id: 's4', name: 'Bruno', steps: [step({ requestId: 'r', source: 'bruno', prerequest: 'bru.setVar("a",1)' })] })
    expect(scn.nodes.find((n) => n.id === 'r:pre')).toMatchObject({ config: { scriptMode: 'bruno-prerequest' } })
  })

  it('is idempotent — same workflow yields a deep-equal scenario', () => {
    const wf = { id: 's5', name: 'Same', steps: [step({ requestId: 'r1', prerequest: 'x', postresponse: 'y' }), step({ requestId: 'r2' })] }
    expect(workflowToScenario(wf)).toEqual(workflowToScenario(wf))
  })
})

describe('toScriptContext (executor input → pm/bru context)', () => {
  it('maps an httpRequest {request,response} envelope to the script context', () => {
    const ctx = toScriptContext({
      request: { url: 'https://api/pets', method: 'GET', headers: { a: '1' } },
      response: { status: 201, statusText: 'Created', headers: { 'x-id': '9' }, body: '{"id":9}', durationMs: 12, success: true }
    })
    expect(ctx.request).toEqual({ url: 'https://api/pets', method: 'GET', headers: { a: '1' } })
    expect(ctx.response).toEqual({ code: 201, statusText: 'Created', headers: { 'x-id': '9' }, body: '{"id":9}', responseTime: 12 })
  })

  it('stringifies a non-string body and tolerates a bare/empty input', () => {
    expect(toScriptContext({ response: { status: 200, body: { ok: true } } }).response?.body).toBe('{"ok":true}')
    expect(toScriptContext(undefined)).toEqual({ request: { url: '', method: 'GET', headers: {} } })
  })
})
