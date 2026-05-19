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
import { StringValue } from '../../src/shared/types/valueTypes'
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
