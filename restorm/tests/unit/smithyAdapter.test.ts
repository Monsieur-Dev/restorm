import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { smithyImportAdapter } from '../../src/main/services/import/idempotent/SmithyAdapter'
import type { GenericOperationShape } from '../../src/main/services/import/idempotent/types'

const jsonAst: unknown = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'smithy', 'weather.json'), 'utf-8'))

describe('smithyImportAdapter.extractNormalizedSpec', () => {
  it('emits one normalised operation per operation shape, HTTP-bound or not', () => {
    const spec = smithyImportAdapter.extractNormalizedSpec(jsonAst, {})
    expect(spec.operations.map((o) => o.operationId).sort()).toEqual([
      'GetCity', 'GetForecast', 'GetServerTime', 'ListCities'
    ])
  })

  it('keys HTTP-bound operations by METHOD + uri, and unbound ones by operation name', () => {
    const spec = smithyImportAdapter.extractNormalizedSpec(jsonAst, {})
    const getCity = spec.operations.find((o) => o.operationId === 'GetCity')
    expect(getCity?.naturalKey).toBe('GET /cities/{cityId}')
    const getServerTime = spec.operations.find((o) => o.operationId === 'GetServerTime')
    expect(getServerTime?.naturalKey).toBe('operation GetServerTime')
  })

  it('carries the http binding + parameter locations on the generic shape', () => {
    const spec = smithyImportAdapter.extractNormalizedSpec(jsonAst, {})
    const getForecast = spec.operations.find((o) => o.operationId === 'GetForecast')
    const shape = getForecast?.shape as GenericOperationShape
    expect(shape.protocol).toBe('smithy')
    const raw = shape.raw as { http?: { method: string; uri: string }; parameters: { name: string; location: string }[] }
    expect(raw.http).toEqual({ method: 'GET', uri: '/cities/{cityId}/forecast' })
    expect(raw.parameters.find((p) => p.name === 'cityId')?.location).toBe('path')
    expect(raw.parameters.find((p) => p.name === 'unit')?.location).toBe('query')
  })

  it('builds models from structure shapes and enums from enum shapes', () => {
    const spec = smithyImportAdapter.extractNormalizedSpec(jsonAst, {})
    const cityCoordinates = spec.models.find((m) => m.name === 'CityCoordinates')
    expect(cityCoordinates).toBeDefined()
    expect(cityCoordinates?.properties.map((p) => p.name).sort()).toEqual(['latitude', 'longitude'])
    expect(cityCoordinates?.properties.every((p) => p.required)).toBe(true)

    const unitEnum = spec.enums.find((e) => e.name === 'TemperatureUnit')
    expect(unitEnum?.values.sort()).toEqual(['CELSIUS', 'FAHRENHEIT'])
  })

  it('is idempotent — extracting twice from the same raw spec yields equal output', () => {
    const first = smithyImportAdapter.extractNormalizedSpec(jsonAst, {})
    const second = smithyImportAdapter.extractNormalizedSpec(jsonAst, {})
    expect(second).toEqual(first)
  })
})
