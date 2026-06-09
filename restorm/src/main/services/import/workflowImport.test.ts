// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('inherits collection- and folder-level scripts in Postman run order', () => {
    const json = JSON.stringify({
      info: { name: 'Inherit', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      event: [
        { listen: 'prerequest', script: { exec: ['collPre()'] } },
        { listen: 'test', script: { exec: ['collTest()'] } }
      ],
      item: [
        {
          name: 'Folder',
          event: [
            { listen: 'prerequest', script: { exec: ['folderPre()'] } },
            { listen: 'test', script: { exec: ['folderTest()'] } }
          ],
          item: [
            {
              name: 'Req',
              event: [
                { listen: 'prerequest', script: { exec: ['reqPre()'] } },
                { listen: 'test', script: { exec: ['reqTest()'] } }
              ],
              request: { method: 'GET', url: 'https://api.test/x' }
            }
          ]
        }
      ]
    })
    const scn = expectScenario(importPostmanFromJson(json))
    const pre = scn.nodes.find((n) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === 'postman-prerequest')
    const post = scn.nodes.find((n) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === 'postman-postresponse')
    // pre: collection → folder → request
    expect((pre?.config as { code: string }).code).toBe('collPre()\n\nfolderPre()\n\nreqPre()')
    // test: request → folder → collection
    expect((post?.config as { code: string }).code).toBe('reqTest()\n\nfolderTest()\n\ncollTest()')
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

  it('lowers Bruno vars + assert blocks into bru.setVar / test() lines', () => {
    const content = bru('login', 1,
      '\nvars:post-response {\n  token: res.body.token\n}\n\nassert {\n  res.status: eq 200\n  res.body.name: isString\n}\n')
    const folder = importBruno({ collection: { name: 'V', version: '1' }, files: [{ path: 'login.bru', content }] })
    const scn = expectScenario(folder)
    const post = scn.nodes.find((n) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === 'bruno-postresponse')
    const code = (post?.config as { code: string }).code
    expect(code).toContain('bru.setVar("token", res.body.token)')
    expect(code).toContain('expect(res.status).to.eql(200)')
    expect(code).toContain("expect(res.body.name).to.be.a('string')")
  })

  it('inherits collection.bru scripts into each request', () => {
    const collectionBru = 'script:pre-request {\n  collPre()\n}\n\nscript:post-response {\n  collPost()\n}\n'
    const folder = importBruno({
      collection: { name: 'Inherit', version: '1' },
      files: [
        { path: 'collection.bru', content: collectionBru },
        { path: 'req.bru', content: bru('req', 1, '\nscript:pre-request {\n  reqPre()\n}\n\nscript:post-response {\n  reqPost()\n}\n') }
      ]
    })
    const scn = expectScenario(folder)
    // collection.bru itself must NOT become a request node.
    expect(scn.nodes.filter((n) => n.kind === 'httpRequest')).toHaveLength(1)
    const pre = scn.nodes.find((n) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === 'bruno-prerequest')
    const post = scn.nodes.find((n) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === 'bruno-postresponse')
    expect((pre?.config as { code: string }).code).toBe('collPre()\n\nreqPre()')
    expect((post?.config as { code: string }).code).toBe('reqPost()\n\ncollPost()')
  })
})

// A real Postman export (built in Postman via MCP from the docker petstore) — the
// end-to-end compat check: a genuine collection with the full pm.* surface must
// import into a runnable workflow scenario.
describe('real Postman export fixture (petstore workflow) → scenario', () => {
  const fixture = readFileSync(join(__dirname, '../../../../tests/e2e/samples/petstore-workflow.postman_collection.json'), 'utf-8')

  it('imports the exported workflow into a scenario with all 6 requests + their (real-code) scripts', () => {
    const folder = importPostmanFromJson(fixture)
    const scn = findScenario(folder)
    if (!scn) throw new Error('expected a workflow scenario from the petstore export')
    expect(scn.name).toBe('Petstore Workflows (restorm compat) — Workflow')
    // 6 requests → 6 httpRequest nodes.
    expect(scn.nodes.filter((n) => n.kind === 'httpRequest')).toHaveLength(6)
    // Pre/post scripts captured verbatim with the right scriptMode.
    const preModes = scn.nodes.filter((n) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === 'postman-prerequest')
    const postModes = scn.nodes.filter((n) => n.kind === 'code' && (n.config as { scriptMode?: string }).scriptMode === 'postman-postresponse')
    // Every request inherits the collection-level pre-request script, so all 6
    // get a pre node (Create Pet + Delete Pet also have their own).
    expect(preModes.length).toBe(6)
    expect(postModes.length).toBe(6) // every request has a test script
    // The inherited collection-level pre-request (pm.info) is prepended everywhere.
    expect(preModes.every((n) => (n.config as { code: string }).code.includes('pm.info.requestName'))).toBe(true)
    // The verbatim pm.* surface + the REAL code (not just asserts) survived the round-trip.
    const allCode = scn.nodes.filter((n) => n.kind === 'code').map((n) => (n.config as { code: string }).code).join('\n')
    expect(allCode).toContain('pm.collectionVariables.set')
    expect(allCode).toContain('pm.response.to.have.status(200)')
    expect(allCode).toContain('pm.sendRequest(')
    expect(allCode).toContain('pm.execution.setNextRequest')
    // Real-code nodes: the programmatic payload builder + the inventory aggregator.
    expect(allCode).toContain('categories.map(')
    expect(allCode).toContain('.reduce(')
  })

  it('wires the full setNextRequest chain — a control edge between every box', () => {
    const folder = importPostmanFromJson(fixture)
    const scn = findScenario(folder)
    if (!scn) throw new Error('expected a workflow scenario')
    // request name → imported request id
    const idByName = new Map<string, string>()
    for (const item of folder.items) {
      const name = (item as { name?: string }).name
      const id = (item as { id?: string }).id
      if (name && id) idByName.set(name, id)
    }
    const hasNode = (id: string): boolean => scn.nodes.some((n) => n.id === id)
    // A request's chain head = its pre node if present, else its http node; tail = its post node.
    const head = (name: string): string => {
      const rid = idByName.get(name)
      return hasNode(`${rid}:pre`) ? `${rid}:pre` : `${rid}:http`
    }
    const tail = (name: string): string => `${idByName.get(name)}:post`
    const chainEdge = (from: string, to: string): boolean =>
      scn.edges.some((e) => e.from.nodeId === tail(from) && e.from.portId === 'done' && e.to.nodeId === head(to))

    // Login → Create Pet → Get Pet → Update Pet Status → Get Inventory Summary → Delete Pet.
    expect(chainEdge('Login', 'Create Pet')).toBe(true)
    expect(chainEdge('Create Pet', 'Get Pet')).toBe(true)
    expect(chainEdge('Get Pet', 'Update Pet Status')).toBe(true)
    expect(chainEdge('Update Pet Status', 'Get Inventory Summary')).toBe(true)
    expect(chainEdge('Get Inventory Summary', 'Delete Pet')).toBe(true)
    // Delete Pet ends the run (postman.setNextRequest(null)) → no outgoing chain edge.
    expect(scn.edges.some((e) => e.from.nodeId === tail('Delete Pet') && e.from.portId === 'done')).toBe(false)
  })
})
