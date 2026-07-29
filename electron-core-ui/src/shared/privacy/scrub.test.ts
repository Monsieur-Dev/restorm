// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  scrubPayload,
  scrubString,
  assertScrubbed,
  findScrubViolations,
  PayloadNotScrubbedError,
  REDACTED,
  REDACTED_BODY,
  REDACTED_EMAIL,
  REDACTED_IP,
  REDACTED_TOKEN,
  REDACTED_URL,
  REDACTED_CIRCULAR,
  REDACTED_DEPTH
} from './scrub'

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'

describe('scrubString — credentials', () => {
  it('redacts a JWT anywhere in the text', () => {
    expect(scrubString(`token=${JWT} rest`)).toBe(`token=${REDACTED_TOKEN} rest`)
  })

  it('keeps the auth scheme but redacts the credential after it', () => {
    expect(scrubString('Authorization: Bearer sk_live_abcdef123456'))
      .toBe(`Authorization: Bearer ${REDACTED_TOKEN}`)
  })

  it('redacts a high-entropy blob with no recognisable framing', () => {
    const key = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
    expect(scrubString(`key ${key}`)).toBe(`key ${REDACTED_TOKEN}`)
  })

  it('leaves ordinary prose and short identifiers alone', () => {
    const text = 'Failed to resolve variable baseUrl in folder Checkout'
    expect(scrubString(text)).toBe(text)
  })

  it('redacts a caller-supplied literal secret wherever it appears', () => {
    const out = scrubString('db=postgres pwd=hunter2000 done', { redactValues: ['hunter2000'] })
    expect(out).toBe(`db=postgres pwd=${REDACTED} done`)
  })

  it('ignores a literal shorter than 4 characters — too generic to redact safely', () => {
    expect(scrubString('a b c', { redactValues: ['b'] })).toBe('a b c')
  })
})

describe('scrubString — URLs', () => {
  it('strips the whole URL by default', () => {
    expect(scrubString('GET https://api.acme-internal.corp/v2/orders?id=7 failed'))
      .toBe(`GET ${REDACTED_URL} failed`)
  })

  it('keeps only scheme + host under the host policy', () => {
    expect(scrubString('GET https://api.example.com/v2/orders?token=abc', { urlPolicy: 'host' }))
      .toBe('GET https://api.example.com')
  })

  it('drops URL userinfo under the host policy', () => {
    expect(scrubString('https://alice:s3cret@api.example.com/x', { urlPolicy: 'host' }))
      .toBe('https://api.example.com')
  })

  it('strips websocket URLs too', () => {
    expect(scrubString('connect wss://stream.example.com/socket')).toBe(`connect ${REDACTED_URL}`)
  })
})

describe('scrubString — paths and PII', () => {
  it('collapses the home directory to ~ but keeps the rest of a stack frame', () => {
    expect(scrubString('at run (/home/alice/projects/api/src/index.ts:42:11)'))
      .toBe('at run (~/projects/api/src/index.ts:42:11)')
  })

  it('collapses the macOS and Windows home shapes as well', () => {
    expect(scrubString('/Users/alice/Documents/x.json')).toBe('~/Documents/x.json')
    expect(scrubString('C:\\Users\\alice\\AppData\\Roaming')).toBe('~\\AppData\\Roaming')
  })

  it('collapses a file:// stack frame without destroying the path', () => {
    expect(scrubString('at file:///home/alice/app/dist/main.js:9:2'))
      .toBe('at file://~/app/dist/main.js:9:2')
  })

  it('collapses an explicitly supplied home directory that matches no platform shape', () => {
    expect(scrubString('/srv/jail/u42/app/x.ts', { homeDir: '/srv/jail/u42' })).toBe('~/app/x.ts')
  })

  it('leaves a system path that carries no user identity', () => {
    expect(scrubString('at /usr/lib/node/internal/modules.js:1:1'))
      .toBe('at /usr/lib/node/internal/modules.js:1:1')
  })

  it('redacts e-mail addresses and IPv4 literals', () => {
    expect(scrubString('user alice@example.com from 192.168.1.24'))
      .toBe(`user ${REDACTED_EMAIL} from ${REDACTED_IP}`)
  })
})

describe('scrubPayload — structural rules', () => {
  it('redacts every sensitive key whatever its casing or separators', () => {
    const out = scrubPayload({
      Authorization: 'Bearer abc',
      'x-api-key': 'k',
      xApiKey: 'k',
      REFRESH_TOKEN: 't',
      cookie: 'sid=1',
      author: 'Ada Lovelace'
    }) as Record<string, unknown>
    expect(out['Authorization']).toBe(REDACTED)
    expect(out['x-api-key']).toBe(REDACTED)
    expect(out['xApiKey']).toBe(REDACTED)
    expect(out['REFRESH_TOKEN']).toBe(REDACTED)
    expect(out['cookie']).toBe(REDACTED)
    // `author` contains "auth" but is not a credential — it must survive.
    expect(out['author']).toBe('Ada Lovelace')
  })

  it('drops request and response bodies wholesale, structure included', () => {
    const out = scrubPayload({
      body: { card: '4111111111111111' },
      responseBody: 'plain text',
      payload: [1, 2, 3]
    }) as Record<string, unknown>
    expect(out['body']).toBe(REDACTED_BODY)
    expect(out['responseBody']).toBe(REDACTED_BODY)
    expect(out['payload']).toBe(REDACTED_BODY)
  })

  it('walks nested objects and arrays', () => {
    const out = scrubPayload({
      breadcrumbs: [{ meta: { url: 'https://api.example.com/orders/9' } }]
    }) as { breadcrumbs: { meta: { url: string } }[] }
    expect(out.breadcrumbs[0]?.meta.url).toBe(REDACTED_URL)
  })

  it('normalises an Error into a scrubbed plain object', () => {
    const error = new Error('failed calling https://api.example.com/x')
    error.stack = 'Error: boom\n    at f (/home/alice/app/x.ts:1:1)'
    const out = scrubPayload(error) as { name: string; message: string; stack: string }
    expect(out.name).toBe('Error')
    expect(out.message).toBe(`failed calling ${REDACTED_URL}`)
    expect(out.stack).toBe('Error: boom\n    at f (~/app/x.ts:1:1)')
  })

  it('collapses a cycle instead of recursing forever', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node['self'] = node
    const out = scrubPayload(node) as Record<string, unknown>
    expect(out['self']).toBe(REDACTED_CIRCULAR)
  })

  it('collapses anything nested past maxDepth', () => {
    const out = scrubPayload({ a: { b: { c: 'deep' } } }, { maxDepth: 2 }) as { a: { b: unknown } }
    expect(out.a.b).toBe(REDACTED_DEPTH)
  })

  it('leaves numbers, booleans and null untouched', () => {
    const out = scrubPayload({ n: 42, b: true, z: null }) as Record<string, unknown>
    expect(out).toEqual({ n: 42, b: true, z: null })
  })
})

describe('assertScrubbed — fail closed', () => {
  it('rejects a payload carrying a raw Authorization header', () => {
    expect(() => { assertScrubbed({ headers: { Authorization: `Bearer ${JWT}` } }) })
      .toThrow(PayloadNotScrubbedError)
  })

  it('rejects a payload carrying an un-dropped body', () => {
    expect(() => { assertScrubbed({ body: 'anything' }) }).toThrow(PayloadNotScrubbedError)
  })

  it('rejects a raw URL, file path, e-mail and IP, naming the rule and the path', () => {
    const violations = findScrubViolations({
      event: { url: 'https://api.example.com/x', stack: 'at /home/alice/a.ts', who: 'a@b.com', ip: '10.0.0.1' }
    })
    expect(violations.map((v) => `${v.path}:${v.rule}`)).toEqual([
      '$.event.url:url',
      '$.event.stack:home-path',
      '$.event.who:email',
      '$.event.ip:ip'
    ])
  })

  it('accepts what scrubPayload produced — scrub then assert is a fixed point', () => {
    const dirty = {
      message: `POST https://api.acme.corp/v1/pay from alice@acme.corp at 10.1.2.3 with ${JWT}`,
      stack: 'at handler (/home/alice/app/src/pay.ts:12:3)\n    at /usr/lib/node/run.js:1:1',
      headers: { Authorization: 'Bearer sk_live_abcdef123456', 'content-type': 'application/json' },
      body: { amount: 100 },
      breadcrumbs: [{ url: 'wss://stream.acme.corp/ws', note: 'retry 2' }],
      meta: { version: '1.4.2', platform: 'linux' }
    }
    const clean = scrubPayload(dirty)
    expect(findScrubViolations(clean)).toEqual([])
    expect(() => { assertScrubbed(clean) }).not.toThrow()
  })

  it('is a fixed point under the host URL policy too', () => {
    const options = { urlPolicy: 'host' as const }
    const clean = scrubPayload({ url: 'https://api.example.com/v1/x?k=1' }, options)
    expect(() => { assertScrubbed(clean, options) }).not.toThrow()
    // …and the stricter default still rejects what the looser policy allowed.
    expect(() => { assertScrubbed(clean) }).toThrow(PayloadNotScrubbedError)
  })

  it('rejects a caller-declared secret that survived, even in a harmless-looking field', () => {
    const options = { redactValues: ['hunter2000'] }
    expect(() => { assertScrubbed({ note: 'password is hunter2000' }, options) })
      .toThrow(PayloadNotScrubbedError)
    expect(() => { assertScrubbed(scrubPayload({ note: 'password is hunter2000' }, options), options) })
      .not.toThrow()
  })

  it('survives an IP-literal host and a very long DNS label under the host policy', () => {
    // Both used to be mangled by the IP / long-blob rules AFTER the URL rule had
    // produced `scheme://host`, leaving output that no longer round-tripped and
    // made assertScrubbed throw on an already-scrubbed payload.
    const options = { urlPolicy: 'host' as const }
    const longLabel = `${'a'.repeat(40)}.example.com`
    for (const url of ['https://192.168.1.1/report?k=1', `https://${longLabel}/x`]) {
      const clean = scrubString(url, options)
      expect(scrubString(clean, options)).toBe(clean)
      expect(() => { assertScrubbed(clean, options) }).not.toThrow()
    }
    expect(scrubString('https://192.168.1.1/report?k=1', options)).toBe('https://192.168.1.1')
  })

  it('is idempotent for every rule — the property the fail-closed contract rests on', () => {
    const samples = [
      `Bearer sk_live_abcdef123456 ${JWT}`,
      'GET https://api.acme.corp/v1/pay?token=abc',
      'at f (/home/alice/app/x.ts:1:1) file:///Users/bob/y.ts',
      'mail alice@example.com from 10.0.0.1',
      'C:\\Users\\carol\\AppData',
      'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      'nothing sensitive at all'
    ]
    for (const policy of ['strip', 'host'] as const) {
      for (const sample of samples) {
        const once = scrubString(sample, { urlPolicy: policy })
        expect(scrubString(once, { urlPolicy: policy }), `not idempotent: ${sample}`).toBe(once)
      }
    }
  })

  it('does not let a literal that occurs inside a marker rewrite the scrubber output', () => {
    // `redactValues: ['redacted']` would otherwise chew on `[redacted-url]` on
    // every pass and never converge.
    const options = { redactValues: ['redacted'] }
    const once = scrubString('see https://api.example.com/x', options)
    expect(scrubString(once, options)).toBe(once)
  })

  it('rejects a `toJSON` object whose serialised form leaks — a key walk sees nothing', () => {
    const url = new URL('https://internal.corp/admin?token=s3cret')
    expect(Object.keys(url)).toEqual([])           // a naive key walk finds nothing to scrub…
    expect(JSON.stringify({ u: url })).toContain('s3cret') // …yet this is what goes on the wire
    expect(() => { assertScrubbed({ u: url }) }).toThrow(PayloadNotScrubbedError)
    expect(findScrubViolations(scrubPayload({ u: url }))).toEqual([])
  })

  it('rejects a raw Error, whose message and stack are own but non-enumerable', () => {
    const error = new Error('failed calling https://api.example.com/x')
    error.stack = 'Error: boom\n    at f (/home/alice/app/x.ts:1:1)'
    expect(Object.keys(error)).toEqual([])
    const violations = findScrubViolations({ err: error })
    expect(violations.map((v) => v.path)).toEqual(['$.err.message', '$.err.stack'])
  })

  it('rejects an object that survived past maxDepth instead of walking past it', () => {
    const violations = findScrubViolations({ a: { b: { c: { d: 'x' } } } }, { maxDepth: 2 })
    expect(violations).toEqual([{ path: '$.a.b', rule: 'depth' }])
  })

  it('rejects an unscrubbed cycle', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node['self'] = node
    expect(findScrubViolations(node)).toEqual([{ path: '$.self', rule: 'circular' }])
  })

  it('keeps a repeated (non-cyclic) reference instead of collapsing it to [circular]', () => {
    const shared = { note: 'shared context' }
    const out = scrubPayload({ a: shared, b: shared }) as { a: unknown; b: unknown }
    expect(out.a).toEqual({ note: 'shared context' })
    expect(out.b).toEqual({ note: 'shared context' })
  })

  it('drops every body key, whatever wrapper the HTTP client used', () => {
    // `data` is axios's name for the body on BOTH sides — `config.data` is the
    // request, `response.data` the response — and fetch wrappers copy it.
    const out = scrubPayload({
      response: { status: 200, data: { card: '4111111111111111' } },
      config: { data: 'raw=1' },
      request: { data: 'raw=2' },
      data: { ssn: '123-45-6789' }
    }) as Record<string, Record<string, unknown> | string>
    expect((out['response'] as Record<string, unknown>)['data']).toBe(REDACTED_BODY)
    expect((out['config'] as Record<string, unknown>)['data']).toBe(REDACTED_BODY)
    expect((out['request'] as Record<string, unknown>)['data']).toBe(REDACTED_BODY)
    expect(out['data']).toBe(REDACTED_BODY)
    expect(JSON.stringify(out)).not.toContain('4111111111111111')
    expect(JSON.stringify(out)).not.toContain('123-45-6789')
    expect(findScrubViolations(out)).toEqual([])
  })

  it('drops an SDK breadcrumb\'s data too — the accepted cost of the blanket rule', () => {
    // Documented deliberately: scoping `data` to known parents was tried and
    // silently missed `config.data`, so the aggressive rule wins and a
    // breadcrumb's structured detail goes with it.
    const out = scrubPayload({ breadcrumbs: [{ data: { note: 'clicked send' } }] }) as
      { breadcrumbs: { data: unknown }[] }
    expect(out.breadcrumbs[0]?.data).toBe(REDACTED_BODY)
  })

  it('rejects an un-dropped response body', () => {
    expect(() => { assertScrubbed({ response: { data: { card: '4111111111111111' } } }) })
      .toThrow(PayloadNotScrubbedError)
  })

  it('rejects the credentials an HTTP client hangs off a rejected-request Error', () => {
    // The axios / fetch-wrapper shape, and the likeliest error object an API
    // client's crash reporter will ever be handed: the failed request rides
    // along as ordinary enumerable properties.
    const error = Object.assign(new Error('Request failed with status code 401'), {
      config: { url: 'https://api.acme.corp/v1/pay', headers: { Authorization: 'Bearer sk_live_abcdef123456' } },
      response: { status: 401, data: { detail: 'bad token' } }
    })
    expect(JSON.stringify(error)).toContain('sk_live_abcdef123456')
    const violations = findScrubViolations({ err: error })
    expect(violations.map((v) => `${v.path}:${v.rule}`)).toContain('$.err.config.headers.Authorization:sensitive-key')
    expect(violations.map((v) => `${v.path}:${v.rule}`)).toContain('$.err.config.url:url')

    const clean = scrubPayload({ err: error })
    expect(JSON.stringify(clean)).not.toContain('sk_live_abcdef123456')
    expect(JSON.stringify(clean)).not.toContain('api.acme.corp')
    expect(JSON.stringify(clean)).not.toContain('bad token')
    expect(findScrubViolations(clean)).toEqual([])
    // …and the diagnostic value survives.
    expect((clean as { err: { message: string } }).err.message).toBe('Request failed with status code 401')
  })

  it('survives a toJSON that returns its own object instead of blowing the stack', () => {
    // Pathological but reachable: a scrubber that crashes the main process is a
    // worse outcome than the leak it was guarding against.
    const selfish: Record<string, unknown> = { name: 'x' }
    selfish['toJSON'] = () => selfish
    expect(() => scrubPayload(selfish)).not.toThrow()
    expect(scrubPayload(selfish)).toBe(REDACTED_CIRCULAR)
    expect(() => findScrubViolations(selfish)).not.toThrow()
  })

  it('bounds a toJSON chain that keeps re-wrapping its own object', () => {
    const wrapper: Record<string, unknown> = { name: 'x' }
    wrapper['toJSON'] = () => ({ wrapped: wrapper })
    expect(() => scrubPayload(wrapper)).not.toThrow()
  })

  it('scrubs a long non-matching tail in linear time', () => {
    // The e-mail rule used to backtrack quadratically here (seconds on a
    // 30 000-char minified stack, on the main process).
    const started = Date.now()
    scrubString(`x@${'a'.repeat(60000)}`)
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('reports every violation on the error, not just the first', () => {
    try {
      assertScrubbed({ a: 'https://x.example.com/1', b: 'c@d.com' })
      expect.unreachable('assertScrubbed should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadNotScrubbedError)
      expect((error as PayloadNotScrubbedError).violations).toHaveLength(2)
      // The message names paths + rules, never the offending value itself.
      expect((error as PayloadNotScrubbedError).message).not.toContain('c@d.com')
    }
  })
})
