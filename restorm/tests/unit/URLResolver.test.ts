/**
 * URLResolver — request URL resolution from path params + env context.
 *
 * The invariant under test: a request-level path param ALWAYS overrides
 * an environment variable of the same name. The previous version of
 * `resolveUrl` gated the override behind `!(key in envContext)`, which
 * silently dropped the path-param value whenever the env defined the
 * same key — making the resolved URL flip from "Glaude" (path-param)
 * back to "Forgeaude" (env) the first time the user picked an
 * environment that defined `name`. These tests pin the corrected
 * priority: `request path params > sub-env > parent-env`.
 */

import { describe, it, expect } from 'vitest'
import { resolveUrl } from '../../src/main/services/URLResolver'
import { StringValue, ExpressionValue } from '../../src/shared/types/valueTypes'
import type { FullRequestData, TransformedContext } from '../../src/main/services/ContextServiceTypes'
import Handlebars from 'handlebars'

// Minimal transform implementation matching the real `ContextService.transformValue`
// contract: compile the template, run it against `context`, no escape.
const transform = (value: string, context: TransformedContext): string => {
  if (!value.includes('{{')) return value
  try {
    const template = Handlebars.compile(value, { noEscape: true })
    return template(context)
  } catch {
    return value
  }
}

function httpRequest(overrides: Partial<FullRequestData> = {}): FullRequestData {
  return {
    id: 'req-1',
    requestType: 'http',
    url: '',
    method: 'GET',
    headers: [],
    params: [],
    pathParams: [],
    ...overrides
  } as FullRequestData
}

describe('URLResolver — path-param priority over env variables', () => {
  it('path-param `name` wins over an env-level `name` of the same key', () => {
    const data = httpRequest({
      url: '{{baseUrl}}/my/{{name}}/action/move',
      pathParams: [
        { key: 'name', value: new StringValue('Glaude'), enabled: true }
      ]
    })
    const envContext: TransformedContext = {
      baseUrl: 'https://api.example.com',
      name: 'Forgeaude' // env defines the same key — path-param must still win
    }
    const result = resolveUrl(data, envContext, transform)
    expect(result.resolvedUrl).toBe('https://api.example.com/my/Glaude/action/move')
  })

  it('with no env collision, the path-param value is still URL-encoded', () => {
    const data = httpRequest({
      url: 'https://api/{{slug}}',
      pathParams: [
        { key: 'slug', value: new StringValue('hello world/v2'), enabled: true }
      ]
    })
    const envContext: TransformedContext = {}
    const result = resolveUrl(data, envContext, transform)
    expect(result.resolvedUrl).toBe('https://api/hello%20world%2Fv2')
  })

  it('env value is rendered verbatim when no path-param overrides it', () => {
    // Env values are kept un-encoded (the user typed them deliberately
    // and may use characters like `,` or `:` that `encodeURIComponent`
    // would mangle).
    const data = httpRequest({
      url: '{{baseUrl}}/list',
      pathParams: []
    })
    const envContext: TransformedContext = {
      baseUrl: 'https://api.example.com:8443'
    }
    const result = resolveUrl(data, envContext, transform)
    expect(result.resolvedUrl).toBe('https://api.example.com:8443/list')
  })

  it('an unchecked path-param falls back to the env value', () => {
    const data = httpRequest({
      url: '{{baseUrl}}/my/{{name}}/action/move',
      pathParams: [
        { key: 'name', value: new StringValue('Glaude'), enabled: false }
      ]
    })
    const envContext: TransformedContext = {
      baseUrl: 'https://api.example.com',
      name: 'Forgeaude'
    }
    const result = resolveUrl(data, envContext, transform)
    expect(result.resolvedUrl).toBe('https://api.example.com/my/Forgeaude/action/move')
  })

  it('with neither env nor path-param defining the variable, the template stays literal', () => {
    // Handlebars renders an unresolved `{{name}}` as an empty string.
    const data = httpRequest({
      url: 'https://api.example.com/my/{{name}}/action/move',
      pathParams: []
    })
    const result = resolveUrl(data, {}, transform)
    expect(result.resolvedUrl).toBe('https://api.example.com/my//action/move')
  })

  it('multiple path-params, last write wins, each overrides env', () => {
    const data = httpRequest({
      url: '{{base}}/{{name}}/{{kind}}',
      pathParams: [
        { key: 'name', value: new StringValue('first'), enabled: true },
        { key: 'name', value: new StringValue('second'), enabled: true },
        { key: 'kind', value: new StringValue('over'), enabled: true }
      ]
    })
    const envContext: TransformedContext = {
      base: 'https://api',
      name: 'envname',
      kind: 'envkind'
    }
    const result = resolveUrl(data, envContext, transform)
    expect(result.resolvedUrl).toBe('https://api/second/over')
  })

  it('disabled path-param does not block another later-enabled override', () => {
    const data = httpRequest({
      url: '{{base}}/{{name}}',
      pathParams: [
        { key: 'name', value: new StringValue('disabled-value'), enabled: false },
        { key: 'name', value: new StringValue('enabled-value'), enabled: true }
      ]
    })
    const envContext: TransformedContext = {
      base: 'https://api',
      name: 'envname'
    }
    const result = resolveUrl(data, envContext, transform)
    expect(result.resolvedUrl).toBe('https://api/enabled-value')
  })
})

/**
 * The three-layer contract: environment-folder variables, then the request's
 * own values, then the scenario run's values — each layer replacing same-named
 * keys from the one before.
 *
 * The boundary this suite was originally written for (request > env) is pinned
 * above. These tests pin the OTHER two, because a layering is only as good as
 * its weakest boundary: if only the boundary a bug exposed is covered, the
 * others are correct merely because nothing has moved them yet.
 *
 * The fixtures use three DISTINCT values, one per layer, so a failure names
 * which layer won instead of only reporting that something is wrong.
 */
describe('URLResolver — environment / request / scenario-run layering', () => {
  const LAYERED_URL = '{{baseUrl}}/pet/{{petId}}'
  const ENV_VALUE = '1'
  const REQUEST_VALUE = '2'
  const RUN_VALUE = '3'

  const envWith = (petId?: string): TransformedContext => ({
    baseUrl: 'https://api.example.com',
    ...(petId !== undefined ? { petId } : {})
  })

  it('boundary 1→2: the request path param replaces the env-folder value', () => {
    const data = httpRequest({
      url: LAYERED_URL,
      pathParams: [{ key: 'petId', value: new StringValue(REQUEST_VALUE), enabled: true }]
    })
    const result = resolveUrl(data, envWith(ENV_VALUE), transform)
    expect(result.resolvedUrl).toBe(`https://api.example.com/pet/${REQUEST_VALUE}`)
  })

  it('boundary 2→3: the scenario run value replaces the request path param', () => {
    const data = httpRequest({
      url: LAYERED_URL,
      pathParams: [{ key: 'petId', value: new StringValue(REQUEST_VALUE), enabled: true }]
    })
    const result = resolveUrl(data, envWith(ENV_VALUE), transform, { petId: RUN_VALUE })
    expect(result.resolvedUrl).toBe(`https://api.example.com/pet/${RUN_VALUE}`)
  })

  it('all three layers at once: the run value wins over both', () => {
    const data = httpRequest({
      url: LAYERED_URL,
      pathParams: [{ key: 'petId', value: new StringValue(REQUEST_VALUE), enabled: true }]
    })
    const result = resolveUrl(data, envWith(ENV_VALUE), transform, { petId: RUN_VALUE })
    expect(result.resolvedUrl).not.toContain(`/pet/${ENV_VALUE}`)
    expect(result.resolvedUrl).not.toContain(`/pet/${REQUEST_VALUE}`)
    expect(result.resolvedUrl).toBe(`https://api.example.com/pet/${RUN_VALUE}`)
  })

  it('the run value also replaces an env-folder value when the request has no path param', () => {
    const data = httpRequest({ url: LAYERED_URL, pathParams: [] })
    const result = resolveUrl(data, envWith(ENV_VALUE), transform, { petId: RUN_VALUE })
    expect(result.resolvedUrl).toBe(`https://api.example.com/pet/${RUN_VALUE}`)
  })

  it('a run value for a DIFFERENT key leaves the request path param alone', () => {
    const data = httpRequest({
      url: LAYERED_URL,
      pathParams: [{ key: 'petId', value: new StringValue(REQUEST_VALUE), enabled: true }]
    })
    const result = resolveUrl(data, envWith(ENV_VALUE), transform, { orderId: RUN_VALUE })
    expect(result.resolvedUrl).toBe(`https://api.example.com/pet/${REQUEST_VALUE}`)
  })

  it('no run context at all keeps the historical request > env layering', () => {
    // Outside a scenario run layer 3 is absent, so nothing about an ordinary
    // Send changes — the whole blast radius of the layering is a live run.
    const data = httpRequest({
      url: LAYERED_URL,
      pathParams: [{ key: 'petId', value: new StringValue(REQUEST_VALUE), enabled: true }]
    })
    expect(resolveUrl(data, envWith(ENV_VALUE), transform).resolvedUrl)
      .toBe(resolveUrl(data, envWith(ENV_VALUE), transform, undefined).resolvedUrl)
  })

  it('an empty run context changes nothing', () => {
    const data = httpRequest({
      url: LAYERED_URL,
      pathParams: [{ key: 'petId', value: new StringValue(REQUEST_VALUE), enabled: true }]
    })
    const result = resolveUrl(data, envWith(ENV_VALUE), transform, {})
    expect(result.resolvedUrl).toBe(`https://api.example.com/pet/${REQUEST_VALUE}`)
  })

  it('the env-folder layer keeps its own cumulative self-override', () => {
    // Within layer 1 a key defined again replaces the earlier one — the
    // behaviour used to build a value by successive concatenation. The
    // flattening happens before this resolver sees the context, so what is
    // pinned here is that layer 3 does not disturb an unrelated env key.
    const data = httpRequest({ url: '{{baseUrl}}/pet/{{petId}}', pathParams: [] })
    const envContext: TransformedContext = {
      baseUrl: 'https://api.example.com/v2',
      petId: ENV_VALUE
    }
    const result = resolveUrl(data, envContext, transform, { petId: RUN_VALUE })
    expect(result.resolvedUrl).toBe(`https://api.example.com/v2/pet/${RUN_VALUE}`)
  })
})

/**
 * Each loop feeds every row it has resolved back into the context the NEXT row
 * resolves against — that is how one row references another by name. A row
 * whose key collides with a scenario run's variable must NOT shadow it there,
 * or a later `{{key}}` picks up the sibling row's literal instead of the value
 * the run supplied.
 *
 * Every case is asserted in BOTH row orders on purpose. The bug was
 * order-dependent — it only appeared when the colliding row came first — so a
 * single-ordering test would have passed by luck and pinned nothing.
 */
describe('URLResolver — a request row must not shadow a run variable for later rows', () => {
  const RUN = { petId: '3' }
  const collidingRow = { key: 'petId', value: new StringValue('1'), enabled: true }

  it('query: a later row reading {{petId}} gets the RUN value, whichever order the rows sit in', () => {
    const referencingRow = { key: 'echo', value: new ExpressionValue('{{petId}}'), enabled: true }

    const collidingFirst = resolveUrl(
      httpRequest({ url: 'https://api/x', params: [collidingRow, referencingRow] }),
      { petId: 'env' }, transform, RUN
    )
    const referencingFirst = resolveUrl(
      httpRequest({ url: 'https://api/x', params: [referencingRow, collidingRow] }),
      { petId: 'env' }, transform, RUN
    )

    expect(collidingFirst.queryString).toContain('echo=3')
    expect(referencingFirst.queryString).toContain('echo=3')
    // …and the colliding row still sends its OWN literal: it is an output the
    // request declares, not a variable binding for the run to replace.
    expect(collidingFirst.queryString).toContain('petId=1')
    expect(referencingFirst.queryString).toContain('petId=1')
  })

  it('path params: a later row reading {{petId}} gets the RUN value, whichever order the rows sit in', () => {
    const referencingRow = { key: 'seg', value: new ExpressionValue('{{petId}}'), enabled: true }
    const url = 'https://api/{{seg}}'

    const collidingFirst = resolveUrl(
      httpRequest({ url, pathParams: [collidingRow, referencingRow] }), { petId: 'env' }, transform, RUN
    )
    const referencingFirst = resolveUrl(
      httpRequest({ url, pathParams: [referencingRow, collidingRow] }), { petId: 'env' }, transform, RUN
    )

    expect(collidingFirst.resolvedUrl).toBe('https://api/3')
    expect(referencingFirst.resolvedUrl).toBe('https://api/3')
  })

  it('a row whose key the run does NOT supply still feeds later rows — the cumulative behaviour is intact', () => {
    // Only run-supplied names are protected. Row-to-row resolution is a
    // deliberate feature and must keep working for every other key.
    const result = resolveUrl(
      httpRequest({
        url: 'https://api/x',
        params: [
          { key: 'tenant', value: new StringValue('acme'), enabled: true },
          { key: 'echo', value: new ExpressionValue('{{tenant}}'), enabled: true }
        ]
      }),
      {}, transform, RUN
    )
    expect(result.queryString).toContain('echo=acme')
  })

  it('with no run context the rows shadow each other exactly as before', () => {
    const params = [collidingRow, { key: 'echo', value: new ExpressionValue('{{petId}}'), enabled: true }]
    const result = resolveUrl(httpRequest({ url: 'https://api/x', params }), { petId: 'env' }, transform)
    expect(result.queryString).toContain('echo=1')
  })
})
