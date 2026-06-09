// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { importPostmanFromJson } from './PostmanImportService'
import { importBruno } from './BrunoImportService'
import type { EnvironmentFolder } from '../../../shared/models'
import type { Scenario, ScenarioNode } from '../../../shared/types/scenario'

/** The scenario appended to an imported collection (if any). */
function findScenario(folder: EnvironmentFolder): Scenario | undefined {
  return folder.items.find((i): i is Scenario => (i as { type?: string }).type === 'scenario')
}
/** Find a workflow scenario or fail the test (narrows to non-optional). */
function expectScenario(folder: EnvironmentFolder): Scenario {
  const scn = findScenario(folder)
  if (!scn) throw new Error('expected a workflow scenario to be appended')
  return scn
}
const codeOf = (scn: Scenario, mode: string): string => {
  const node = scn.nodes.find((n: ScenarioNode) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === mode)
  return (node?.config as { code?: string } | undefined)?.code ?? ''
}

describe('Postman workflow import → scenario', () => {
  const collection = JSON.stringify({
    info: { name: 'Pet API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: 'Login',
        request: { method: 'POST', url: 'https://api.test/login' },
        event: [
          { listen: 'prerequest', script: { exec: ["pm.variables.set('attempt', 1)"] } },
          { listen: 'test', script: { exec: ["pm.test('ok', function(){ pm.response.to.have.status(200) })", "pm.environment.set('token', pm.response.json().token)"] } }
        ]
      },
      { name: 'Get Pet', request: { method: 'GET', url: 'https://api.test/pet/1' } }
    ]
  })

  it('appends a workflow scenario with verbatim pre/post code nodes', () => {
    const folder = importPostmanFromJson(collection)
    const scn = expectScenario(folder)
    expect(scn.name).toBe('Pet API — Workflow')
    expect(codeOf(scn, 'postman-prerequest')).toBe("pm.variables.set('attempt', 1)")
    expect(codeOf(scn, 'postman-postresponse')).toContain("pm.environment.set('token', pm.response.json().token)")
    // The httpRequest node binds the imported request id (so it actually runs it).
    const httpNodes = scn.nodes.filter((n) => n.kind === 'httpRequest')
    expect(httpNodes).toHaveLength(2)
    const loginReq = folder.items.find((i) => (i as { name?: string }).name === 'Login')
    const loginId = (loginReq as { id?: string } | undefined)?.id
    expect(httpNodes.some((n) => (n.config as { requestId?: string }).requestId === loginId)).toBe(true)
  })

  it('does NOT create a scenario for a script-free collection', () => {
    const plain = JSON.stringify({
      info: { name: 'Plain', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'A', request: { method: 'GET', url: 'https://api.test/a' } }]
    })
    expect(findScenario(importPostmanFromJson(plain))).toBeUndefined()
  })
})

describe('Bruno workflow import → scenario', () => {
  const bru = (name: string, seq: number, extra = ''): string =>
    `meta {\n  name: ${name}\n  type: http\n  seq: ${seq}\n}\n\nget {\n  url: https://api.test/${name}\n}\n${extra}`

  it('appends a workflow scenario from .bru scripts (post = post-response + tests)', () => {
    const folder = importBruno({
      collection: { name: 'Bruno API', version: '1' },
      files: [
        { path: 'login.bru', content: bru('login', 1, "\nscript:pre-request {\n  bru.setVar('attempt', 1)\n}\n\nscript:post-response {\n  bru.setVar('token', res.getBody().token)\n}\n\ntests {\n  test('ok', function(){ expect(res.getStatus()).to.equal(200) })\n}\n") },
        { path: 'getpet.bru', content: bru('getpet', 2) }
      ]
    })
    const scn = expectScenario(folder)
    expect(scn.name).toBe('Bruno API — Workflow')
    expect(codeOf(scn, 'bruno-prerequest')).toContain("bru.setVar('attempt', 1)")
    const post = codeOf(scn, 'bruno-postresponse')
    expect(post).toContain("bru.setVar('token', res.getBody().token)")
    expect(post).toContain("test('ok'") // tests block appended after post-response
  })

  it('does NOT create a scenario for script-free .bru files', () => {
    const folder = importBruno({
      collection: { name: 'Plain', version: '1' },
      files: [{ path: 'a.bru', content: bru('a', 1) }]
    })
    expect(findScenario(folder)).toBeUndefined()
  })
})
