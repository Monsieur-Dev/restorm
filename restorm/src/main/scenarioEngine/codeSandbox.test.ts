// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { runCodeInSandbox, type SandboxNetworkBridge, type SandboxHttpResponse, type SandboxVariableBridge } from './codeSandbox'

/** A variable bridge backed by a plain Map — the test stand-in for the
 * executor's live run-variable map. */
function mapBridge(init: Record<string, unknown> = {}): { store: Map<string, unknown>; bridge: SandboxVariableBridge } {
  const store = new Map<string, unknown>(Object.entries(init))
  return {
    store,
    bridge: {
      get: (n) => store.get(n),
      set: (n, v) => { store.set(n, v) },
      has: (n) => store.has(n),
      delete: (n) => { store.delete(n) },
      names: () => Array.from(store.keys())
    }
  }
}

describe('codeSandbox', () => {
  it('runs plain JS and returns the value', async () => {
    const { result } = await runCodeInSandbox({ code: 'return 1 + 2' })
    expect(result).toBe(3)
  })

  it('strips TypeScript types and runs', async () => {
    const { result } = await runCodeInSandbox({ code: 'const n: number = 20; const s: string = "x"; return n * 2' })
    expect(result).toBe(40)
  })

  it('exposes the wired input as `input`', async () => {
    const { result } = await runCodeInSandbox({ code: 'return input.x + 1', input: { x: 41 } })
    expect(result).toBe(42)
  })

  it('exposes run variables as `vars`', async () => {
    const { result } = await runCodeInSandbox({ code: 'return vars.greeting + " world"', variables: { greeting: 'hello' } })
    expect(result).toBe('hello world')
  })

  it('bundles lodash (global + require)', async () => {
    const a = await runCodeInSandbox({ code: 'return _.sum([1, 2, 3, 4])' })
    expect(a.result).toBe(10)
    const b = await runCodeInSandbox({ code: 'const ld = require("lodash"); return ld.chunk([1,2,3,4], 2)' })
    expect(b.result).toEqual([[1, 2], [3, 4]])
  })

  it('bundles moment', async () => {
    const { result } = await runCodeInSandbox({ code: 'return moment("2026-01-01").add(1, "day").format("YYYY-MM-DD")' })
    expect(result).toBe('2026-01-02')
  })

  it('captures console.log output', async () => {
    const { logs } = await runCodeInSandbox({ code: 'console.log("hi", 42); console.log({ a: 1 }); return null' })
    expect(logs).toEqual(['hi 42', '{"a":1}'])
  })

  it('surfaces a thrown error', async () => {
    await expect(runCodeInSandbox({ code: 'throw new Error("boom")' })).rejects.toThrow('boom')
  })

  it('has NO access to the host (no require of node builtins, no process)', async () => {
    await expect(runCodeInSandbox({ code: 'return require("fs")' })).rejects.toThrow(/not available in the sandbox/)
    const { result } = await runCodeInSandbox({ code: 'return typeof process' })
    expect(result).toBe('undefined')
  })

  it('kills a runaway loop via the deadline', async () => {
    await expect(runCodeInSandbox({ code: 'while (true) {}', timeoutMs: 300 })).rejects.toThrow()
  }, 5000)

  it('supports top-level await on a resolved promise', async () => {
    const { result } = await runCodeInSandbox({ code: 'const x = await Promise.resolve(41); return x + 1' })
    expect(result).toBe(42)
  })

  it('supports await Promise.all + an async helper', async () => {
    const { result } = await runCodeInSandbox({
      code: 'async function dbl(n: number) { return n * 2 }\nconst xs = await Promise.all([dbl(1), dbl(2), dbl(3)])\nreturn _.sum(xs)'
    })
    expect(result).toBe(12)
  })

  it('resolves await on a setTimeout-backed promise', async () => {
    const { result } = await runCodeInSandbox({ code: 'await new Promise((r) => setTimeout(() => r(undefined), 10)); return "done"' })
    expect(result).toBe('done')
  })

  it('times out an await that never settles', async () => {
    await expect(runCodeInSandbox({ code: 'await new Promise(() => {}); return 1', timeoutMs: 300 })).rejects.toThrow(/timed out/)
  }, 5000)

  // The pure-JS slice of the Postman/Bruno standard library. Each runs the lib
  // for real inside QuickJS (not just "does it bundle").
  describe('Postman/Bruno stdlib', () => {
    it('bundles chai (chai.expect + the bare `expect` alias)', async () => {
      const ok = await runCodeInSandbox({ code: 'chai.expect(2 + 2).to.equal(4); chai.expect([1, 2, 3]).to.have.lengthOf(3); return "ok"' })
      expect(ok.result).toBe('ok')
      const alias = await runCodeInSandbox({ code: 'expect("hi").to.be.a("string"); return "ok"' })
      expect(alias.result).toBe('ok')
      await expect(runCodeInSandbox({ code: 'chai.expect(1).to.equal(2); return "unreached"' })).rejects.toThrow(/expected 1 to equal 2/)
    })

    it('bundles cheerio (jQuery-style HTML traversal)', async () => {
      const { result } = await runCodeInSandbox({
        code: 'const $ = cheerio.load("<h1>Hello</h1><p class=\\"x\\">World</p>"); return $("h1").text() + " " + $(".x").text()'
      })
      expect(result).toBe('Hello World')
    })

    it('bundles xml2js (await parseStringPromise — exercises the events/timers shim)', async () => {
      const { result } = await runCodeInSandbox({ code: 'return await xml2js.parseStringPromise("<root><item>1</item><item>2</item></root>")' })
      expect(result).toEqual({ root: { item: ['1', '2'] } })
    })

    it('bundles ajv-formats (format validators on top of Ajv)', async () => {
      const { result } = await runCodeInSandbox({
        code: 'const ajv = new Ajv(); ajvFormats(ajv); const validate = ajv.compile({ type: "string", format: "email" }); return [validate("a@b.com"), validate("not-an-email")]'
      })
      expect(result).toEqual([true, false])
    })
  })
})

describe('codeSandbox network bridge', () => {
  // An echoing bridge: reflects the request back as the response body.
  const echoNet: SandboxNetworkBridge = (req) =>
    Promise.resolve({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ echo: req.url, method: req.method, body: req.body ?? null })
    })

  it('stays fully offline when no bridge is supplied', async () => {
    const { result } = await runCodeInSandbox({ code: 'return [typeof fetch, typeof pm]' })
    expect(result).toEqual(['undefined', 'undefined'])
  })

  it('exposes an async fetch that delegates to the host bridge', async () => {
    const { result } = await runCodeInSandbox({
      code: 'const r = await fetch("https://api/test"); const j = await r.json(); return { status: r.status, ok: r.ok, echo: j.echo }',
      network: echoNet
    })
    expect(result).toEqual({ status: 200, ok: true, echo: 'https://api/test' })
  })

  it('passes method + body through fetch init', async () => {
    const { result } = await runCodeInSandbox({
      code: 'const r = await fetch("https://api/p", { method: "POST", body: "hello" }); return (await r.json())',
      network: echoNet
    })
    expect(result).toEqual({ echo: 'https://api/p', method: 'POST', body: 'hello' })
  })

  it('runs a Postman `pm.sendRequest(...)` script unchanged', async () => {
    const { result } = await runCodeInSandbox({
      code: `return await new Promise((resolve, reject) => {
        pm.sendRequest({ url: "https://api/pm", method: "PUT" }, (err, res) => {
          if (err) { reject(err); return }
          resolve({ code: res.code, json: res.json(), same: pm.response === res })
        })
      })`,
      network: echoNet
    })
    expect(result).toEqual({ code: 200, json: { echo: 'https://api/pm', method: 'PUT', body: null }, same: true })
  })

  it('ignores a host request that settles AFTER the run times out (no use-after-dispose)', async () => {
    // A bridge that never settles on its own — we resolve it by hand AFTER the
    // sandbox has timed out and torn its context down. With the post-dispose
    // guard this is a silent no-op; without it, the late callback would touch a
    // disposed QuickJS context and surface as an unhandled main-process rejection.
    let settleLate: (r: SandboxHttpResponse) => void = () => undefined
    const slowNet: SandboxNetworkBridge = () => new Promise((resolve) => { settleLate = resolve })

    const rejections: unknown[] = []
    const onRejection = (err: unknown): void => { rejections.push(err) }
    process.on('unhandledRejection', onRejection)
    try {
      await expect(
        runCodeInSandbox({ code: 'await fetch("https://slow/x"); return 1', network: slowNet, timeoutMs: 200 })
      ).rejects.toThrow(/timed out/)
      // Settle the host request now that the context is gone.
      settleLate({ status: 200, statusText: 'OK', headers: {}, body: '{}' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  }, 5000)

  it('aborts an in-flight host request when the run signal fires', async () => {
    // A bridge that only settles when its AbortSignal fires (rejecting like a
    // real aborted request) — proves the run signal reaches the in-flight fetch.
    const abortableNet: SandboxNetworkBridge = (_req, sig) =>
      new Promise((_resolve, reject) => {
        sig.addEventListener('abort', () => { reject(new Error('aborted by run signal')) }, { once: true })
      })
    const controller = new AbortController()
    const run = runCodeInSandbox({
      code: 'await fetch("https://hang/x"); return "unreachable"',
      network: abortableNet,
      signal: controller.signal,
      timeoutMs: 5000
    })
    setTimeout(() => { controller.abort() }, 30)
    await expect(run).rejects.toThrow(/aborted by run signal/)
  }, 5000)

  it('surfaces a bridge error (firewall denial) as a clean in-sandbox throw', async () => {
    const denyNet: SandboxNetworkBridge = () =>
      Promise.resolve({ status: 0, statusText: '', headers: {}, body: '', error: 'host not allowed by firewall' })
    await expect(
      runCodeInSandbox({ code: 'await fetch("https://blocked/x"); return "unreachable"', network: denyNet })
    ).rejects.toThrow(/firewall/)
  })

  describe('variable bridge (__vars)', () => {
    it('reads, writes and lists run variables — writes persist to the host store', async () => {
      const { store, bridge } = mapBridge({ counter: 1, greeting: 'hi' })
      const { result } = await runCodeInSandbox({
        variableBridge: bridge,
        code: `
          __vars.set('counter', __vars.get('counter') + 10)
          __vars.set('name', 'restorm')
          return { counter: __vars.get('counter'), greeting: __vars.get('greeting'), hasName: __vars.has('name'), keys: __vars.keys() }
        `
      })
      // Writes reached the host map (so a later node sees them).
      expect(store.get('counter')).toBe(11)
      expect(store.get('name')).toBe('restorm')
      // Reads (including live-after-write) work inside the script.
      expect(result).toEqual({ counter: 11, greeting: 'hi', hasName: true, keys: ['counter', 'greeting', 'name'] })
    })

    it('round-trips objects and distinguishes unset (undefined) from null', async () => {
      const { store, bridge } = mapBridge({ obj: { a: [1, 2], b: 'x' }, nil: null })
      const { result } = await runCodeInSandbox({
        variableBridge: bridge,
        code: `return { obj: __vars.get('obj'), nil: __vars.get('nil'), missing: __vars.get('nope'), hasMissing: __vars.has('nope') }`
      })
      expect(result).toEqual({ obj: { a: [1, 2], b: 'x' }, nil: null, missing: undefined, hasMissing: false })
      expect(store.get('obj')).toEqual({ a: [1, 2], b: 'x' })
    })

    it('delete / unset / clear remove variables from the host store', async () => {
      const { store, bridge } = mapBridge({ a: 1, b: 2, c: 3 })
      await runCodeInSandbox({
        variableBridge: bridge,
        code: `__vars.delete('a'); __vars.unset('b'); return __vars.keys()`
      })
      expect([...store.keys()]).toEqual(['c'])
      await runCodeInSandbox({ variableBridge: bridge, code: `__vars.clear(); return null` })
      expect(store.size).toBe(0)
    })

    it('omits `__vars` entirely when no bridge is supplied', async () => {
      const { result } = await runCodeInSandbox({ code: `return typeof __vars` })
      expect(result).toBe('undefined')
    })
  })

  describe('postman runtime (pm)', () => {
    it('maps every pm variable scope to the scenario namespace + persists writes', async () => {
      const { store, bridge } = mapBridge({ token: 'abc' })
      const { result } = await runCodeInSandbox({
        variableBridge: bridge,
        postman: {},
        code: `
          pm.environment.set('base', 'https://api.test')
          pm.globals.set('flag', true)
          pm.collectionVariables.set('count', 3)
          return {
            // all scopes read the one namespace
            fromVars: pm.variables.get('base'),
            token: pm.environment.get('token'),
            flag: pm.globals.get('flag'),
            replaced: pm.variables.replaceIn('{{base}}/v{{count}}')
          }
        `
      })
      expect(store.get('base')).toBe('https://api.test')
      expect(store.get('flag')).toBe(true)
      expect(store.get('count')).toBe(3)
      expect(result).toEqual({ fromVars: 'https://api.test', token: 'abc', flag: true, replaced: 'https://api.test/v3' })
    })

    it('runs pm.test → run-log + result.postman.tests (pass and fail)', async () => {
      const { bridge } = mapBridge()
      const { logs, postman } = await runCodeInSandbox({
        variableBridge: bridge,
        postman: {},
        code: `
          pm.test('one plus one', function(){ pm.expect(1 + 1).to.equal(2) })
          pm.test('always fails', function(){ pm.expect(1).to.equal(2) })
        `
      })
      expect(postman?.tests?.[0]).toEqual({ name: 'one plus one', passed: true, error: null })
      expect(postman?.tests?.[1]).toMatchObject({ name: 'always fails', passed: false })
      expect(postman?.tests?.[1]?.error).toContain('expected 1 to equal 2')
      expect(logs.some((l) => l.startsWith('✓ one plus one'))).toBe(true)
      expect(logs.some((l) => l.startsWith('✗ always fails'))).toBe(true)
    })

    it('exposes an injected pm.response with Postman assertions', async () => {
      const { bridge } = mapBridge()
      const { result } = await runCodeInSandbox({
        variableBridge: bridge,
        postman: { response: { code: 200, status: 'OK', headers: { 'content-type': 'application/json' }, body: '{"id":7,"name":"rex"}', responseTime: 12 } },
        code: `
          pm.test('status is 200', function(){ pm.response.to.have.status(200) })
          pm.test('is ok', function(){ pm.response.to.be.ok })
          pm.test('has content-type', function(){ pm.response.to.have.header('Content-Type') })
          var body = pm.response.json()
          pm.environment.set('petId', body.id)
          return { id: body.id, name: body.name, code: pm.response.code, time: pm.response.responseTime }
        `
      })
      expect(result).toEqual({ id: 7, name: 'rex', code: 200, time: 12 })
    })

    it('reports a failing status assertion as a failed pm.test (no throw)', async () => {
      const { bridge } = mapBridge()
      const { postman } = await runCodeInSandbox({
        variableBridge: bridge,
        postman: { response: { code: 404, status: 'Not Found', headers: {}, body: '' } },
        code: `pm.test('expects 200', function(){ pm.response.to.have.status(200) }); return null`
      })
      expect(postman?.tests?.[0]).toMatchObject({ name: 'expects 200', passed: false })
      expect(postman?.tests?.[0]?.error).toContain('404')
    })

    it('captures pm.request mutations (pre-request script) on result.postman.request', async () => {
      const { store, bridge } = mapBridge({ token: 'secret' })
      const { postman } = await runCodeInSandbox({
        variableBridge: bridge,
        postman: { request: { url: 'https://api.test/pets', method: 'GET', headers: {} } },
        code: `
          pm.request.headers['Authorization'] = 'Bearer ' + pm.environment.get('token')
          pm.request.url = pm.request.url + '?limit=10'
          return null
        `
      })
      expect(postman?.request).toEqual({ url: 'https://api.test/pets?limit=10', method: 'GET', headers: { Authorization: 'Bearer secret' } })
      expect(store.get('token')).toBe('secret')
    })

    it('captures setNextRequest for the importer to map to a control edge', async () => {
      const { bridge } = mapBridge()
      const a = await runCodeInSandbox({ variableBridge: bridge, postman: {}, code: `pm.execution.setNextRequest('Login'); return null` })
      expect(a.postman?.nextRequest).toBe('Login')
      const b = await runCodeInSandbox({ variableBridge: bridge, postman: {}, code: `postman.setNextRequest(null); return null` })
      expect(b.postman?.nextRequest).toBeNull()
    })

    it('omits the pm runtime when no postman context is supplied', async () => {
      const { bridge } = mapBridge()
      const { result } = await runCodeInSandbox({ variableBridge: bridge, code: `return typeof pm` })
      expect(result).toBe('undefined')
    })
  })

  describe('bruno runtime (bru / req / res)', () => {
    it('maps bru variable helpers to the scenario namespace + persists writes', async () => {
      const { store, bridge } = mapBridge({ token: 'xyz' })
      const { result } = await runCodeInSandbox({
        variableBridge: bridge,
        bruno: { info: { envName: 'staging', collectionName: 'Pet API' } },
        code: `
          bru.setVar('runtimeVar', 1)
          bru.setEnvVar('base', 'https://api.test')
          return {
            token: bru.getVar('token'),
            hasBase: bru.hasEnvVar('base'),
            collectionVar: bru.getCollectionVar('token'),
            env: bru.getEnvName(),
            coll: bru.getCollectionName()
          }
        `
      })
      expect(store.get('runtimeVar')).toBe(1)
      expect(store.get('base')).toBe('https://api.test')
      expect(result).toEqual({ token: 'xyz', hasBase: true, collectionVar: 'xyz', env: 'staging', coll: 'Pet API' })
    })

    it('also exposes Bruno\'s `pm` compatibility layer', async () => {
      const { store, bridge } = mapBridge()
      const { result } = await runCodeInSandbox({
        variableBridge: bridge,
        bruno: {},
        code: `pm.environment.set('viaPm', 42); return { pm: typeof pm, bru: typeof bru, viaPm: bru.getVar('viaPm') }`
      })
      expect(store.get('viaPm')).toBe(42)
      expect(result).toEqual({ pm: 'object', bru: 'object', viaPm: 42 })
    })

    it('req.* reads and mutates the outgoing request (captured on result)', async () => {
      const { bridge } = mapBridge({ token: 'secret' })
      const { postman } = await runCodeInSandbox({
        variableBridge: bridge,
        bruno: { request: { url: 'https://api.test/pets', method: 'GET', headers: {} } },
        code: `
          req.setHeader('Authorization', 'Bearer ' + bru.getVar('token'))
          req.setUrl(req.getUrl() + '?limit=5')
          return null
        `
      })
      expect(postman?.request).toMatchObject({ url: 'https://api.test/pets?limit=5', method: 'GET', headers: { Authorization: 'Bearer secret' } })
    })

    it('res.* reads the injected response + global test() collects results', async () => {
      const { store, bridge } = mapBridge()
      const { postman } = await runCodeInSandbox({
        variableBridge: bridge,
        bruno: { response: { code: 201, status: 'Created', headers: { 'x-id': '9' }, body: '{"id":9}', responseTime: 7 } },
        code: `
          test('created', function(){ expect(res.getStatus()).to.equal(201) })
          bru.setVar('newId', res.getBody().id)
          return null
        `
      })
      expect(store.get('newId')).toBe(9)
      expect(postman?.tests?.[0]).toEqual({ name: 'created', passed: true, error: null })
    })

    it('captures bru.setNextRequest and bru.runRequest for the importer', async () => {
      const { bridge } = mapBridge()
      const { postman } = await runCodeInSandbox({
        variableBridge: bridge,
        bruno: {},
        code: `bru.setNextRequest('Get Token'); await bru.runRequest('auth/login'); return null`
      })
      expect(postman?.nextRequest).toBe('Get Token')
      expect(postman?.runRequest).toBe('auth/login')
    })

    it('omits the bru runtime when no bruno context is supplied', async () => {
      const { bridge } = mapBridge()
      const { result } = await runCodeInSandbox({ variableBridge: bridge, code: `return typeof bru` })
      expect(result).toBe('undefined')
    })
  })
})
