/**
 * Unit tests for the Smithy import service — covers both accepted input
 * formats (the JSON AST + the `.smithy` IDL), auto-detection, HTTP-trait
 * binding, documentation-only operations, enum extraction, and idempotency.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  importSmithy,
  importSmithyFromString
} from '../../src/main/services/import/SmithyImportService'
import type { Folder, EnvironmentFolder, HTTPRequest } from '../../src/shared/types/collections'
import { importProviders } from '../../src/main/services/import/providers'

const FIXTURES_DIR = join(__dirname, 'fixtures', 'smithy')
const jsonAst = readFileSync(join(FIXTURES_DIR, 'weather.json'), 'utf-8')
const idlText = readFileSync(join(FIXTURES_DIR, 'weather.smithy'), 'utf-8')

const isFolder = (item: unknown): item is Folder =>
  typeof item === 'object' && item !== null && 'items' in item && Array.isArray((item as Folder).items)

const isHTTPRequest = (item: unknown): item is HTTPRequest =>
  typeof item === 'object' && item !== null && 'type' in item && (item as { type: string }).type === 'http'

function findFolder(items: Folder['items'], name: string): Folder | undefined {
  return items.find((i): i is Folder => isFolder(i) && i.name === name)
}

function findRequest(items: Folder['items'], name: string): HTTPRequest | undefined {
  return items.find((i): i is HTTPRequest => isHTTPRequest(i) && i.name === name)
}

/** Narrow an `expect(x).toBeDefined()`-checked value without a `!` assertion. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a defined value')
  return value
}

function requireSmithyProvider(): (typeof importProviders)[number] {
  const provider = importProviders.find((p) => p.format === 'smithy')
  return must(provider)
}

describe.each([
  ['JSON AST', jsonAst],
  ['.smithy IDL', idlText]
])('SmithyImportService — %s input', (_label, content) => {
  it('materialises the resource hierarchy with HTTP-bound operations', () => {
    const result = importSmithyFromString(content, { name: 'Weather' }) as EnvironmentFolder
    expect(result.importSource).toBe('smithy')
    expect(result.name).toBe('Weather')

    const cityFolder = must(findFolder(result.items, 'City'))
    expect(cityFolder.tags).toContain('resource')

    const getCity = findRequest(cityFolder.items, 'GetCity')
    expect(getCity).toBeDefined()
    expect(getCity?.method).toBe('GET')
    expect(getCity?.url).toBe('{{baseUrl}}/cities/{{cityId}}')
    expect(getCity?.pathParams.map((p) => p.key)).toEqual(['cityId'])

    const listCities = findRequest(cityFolder.items, 'ListCities')
    expect(listCities).toBeDefined()
    expect(listCities?.url).toBe('{{baseUrl}}/cities')
    expect(listCities?.params.map((p) => p.key).sort()).toEqual(['nextToken', 'pageSize'])

    const forecastFolder = must(findFolder(cityFolder.items, 'Forecast'))
    const getForecast = findRequest(forecastFolder.items, 'GetForecast')
    expect(getForecast).toBeDefined()
    expect(getForecast?.url).toBe('{{baseUrl}}/cities/{{cityId}}/forecast')
    expect(getForecast?.pathParams.map((p) => p.key)).toEqual(['cityId'])
    expect(getForecast?.params.map((p) => p.key)).toEqual(['unit'])
  })

  it('does not materialise a request for an operation without an @http binding', () => {
    const result = importSmithyFromString(content, { name: 'Weather' }) as EnvironmentFolder
    const allRequests = new Set<string>()
    const walk = (items: Folder['items']): void => {
      for (const item of items) {
        if (isHTTPRequest(item)) allRequests.add(item.name)
        if (isFolder(item)) walk(item.items)
      }
    }
    walk(result.items)
    expect(allRequests.has('GetServerTime')).toBe(false)

    // ...but it's still surfaced as documentation.
    const op = result.apiDocumentation?.operations.find((o) => o.operationId === 'GetServerTime')
    expect(op).toBeDefined()
    expect(op?.extra?.httpBound).toBe(false)
  })

  it('extracts enum shapes into enumDefinitions', () => {
    const result = importSmithyFromString(content, { name: 'Weather' }) as EnvironmentFolder
    const unitEnum = result.enumDefinitions?.find((e) => e.name === 'TemperatureUnit')
    expect(unitEnum).toBeDefined()
    expect(unitEnum?.values.sort()).toEqual(['CELSIUS', 'FAHRENHEIT'])
  })

  it('is idempotent — re-parsing the same input yields structurally equal output', () => {
    const first = importSmithyFromString(content, { name: 'Weather' })
    const second = importSmithyFromString(content, { name: 'Weather' })
    expect(second).toEqual(first)
  })
})

describe('SmithyImportService — auto-detection', () => {
  it('canImport is true for the .smithy extension regardless of content', () => {
    expect(requireSmithyProvider().canImport('anything', 'model.smithy')).toBe(true)
  })

  it('canImport is true for JSON AST content', () => {
    expect(requireSmithyProvider().canImport(jsonAst)).toBe(true)
  })

  it('canImport is true for .smithy IDL content sniffed by namespace + shape keyword', () => {
    expect(requireSmithyProvider().canImport(idlText)).toBe(true)
  })

  it('canImport is false for an empty string or unrelated content', () => {
    const provider = requireSmithyProvider()
    expect(provider.canImport('')).toBe(false)
    expect(provider.canImport('{"openapi": "3.0.0"}')).toBe(false)
    expect(provider.canImport('type Query { pet: Pet }')).toBe(false)
  })

  it('importSmithy dispatches to the right parser for both formats', () => {
    const fromJson = importSmithy(jsonAst, { name: 'Weather' }) as EnvironmentFolder
    const fromIdl = importSmithy(idlText, { name: 'Weather' }) as EnvironmentFolder
    // Both inputs describe the same model — the materialised folder tree
    // (names, methods, URLs) must match regardless of source format.
    expect(fromIdl).toEqual(fromJson)
  })
})
