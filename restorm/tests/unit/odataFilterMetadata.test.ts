/**
 * Unit tests for the OData `$filter` metadata resolvers — property /
 * operator / value suggestion logic + light validation, driven by a
 * minimal in-memory `ApiDocumentation`.
 */
import { describe, it, expect } from 'vitest'
import type { ApiDocumentation } from '../../src/shared/types/apiDocumentation'
import {
  resolveEntityType,
  resolvePropertyPath,
  propertiesFor,
  operatorsForType,
  functionsForType,
  valueSuggestionsForProperty,
  isOperatorValidForType,
  isStringFunction
} from '../../src/shared/utils/odataFilter/odataFilterMetadata'

const PET = 'OData.PetStore.Models.Pet'
const STATUS_ENUM = 'OData.PetStore.Models.PetStatus'
const CATEGORY = 'OData.PetStore.Models.Category'

function makeDoc(overrides?: Partial<ApiDocumentation>): ApiDocumentation {
  return {
    sourceType: 'odata',
    api: { title: 'PetStore' },
    groups: {},
    operations: [],
    models: {
      [PET]: {
        name: 'Pet',
        description: 'Pet',
        properties: [
          { name: 'Id', type: 'Edm.Int32', required: true },
          { name: 'Name', type: 'Edm.String', required: true },
          { name: 'Active', type: 'Edm.Boolean', required: false, format: 'boolean' },
          { name: 'Created', type: 'Edm.DateTimeOffset', required: false, format: 'date-time' },
          { name: 'Ref', type: 'Edm.Guid', required: false, format: 'uuid' },
          { name: 'Status', type: STATUS_ENUM, required: false, targetModelRef: STATUS_ENUM },
          { name: 'Category', type: CATEGORY, required: false, targetModelRef: CATEGORY }
        ]
      },
      [CATEGORY]: {
        name: 'Category',
        properties: [
          { name: 'Id', type: 'Edm.Int32', required: true },
          { name: 'Title', type: 'Edm.String', required: false }
        ]
      },
      // Enum models are emitted by the importer WITHOUT a `properties`
      // array (only `type:'enum'` + `enum`/`enumValues`). Keep the
      // fixture faithful to that runtime shape so the resolvers are
      // exercised against a property-less model — a missing `properties`
      // must never throw.
      [STATUS_ENUM]: {
        name: 'PetStatus',
        enumValues: ['Available', 'Pending', 'Sold']
      } as unknown as ApiDocumentation['models'][string]
    },
    ...overrides
  }
}

describe('resolveEntityType', () => {
  it('returns the model for a known entityTypeRef', () => {
    expect(resolveEntityType(makeDoc(), PET)?.name).toBe('Pet')
  })
  it('returns undefined without a ref (hand-authored request)', () => {
    expect(resolveEntityType(makeDoc(), undefined)).toBeUndefined()
  })
  it('returns undefined without an apiDoc', () => {
    expect(resolveEntityType(undefined, PET)).toBeUndefined()
  })
})

describe('propertiesFor', () => {
  it('lists structural + navigation properties, flagging navigation', () => {
    const doc = makeDoc()
    const props = propertiesFor(doc.models[PET], doc)
    const byName = new Map(props.map((p) => [p.name, p]))
    expect(byName.get('Name')?.isNavigation).toBe(false)
    // Category points at an object model → navigation
    expect(byName.get('Category')?.isNavigation).toBe(true)
    // Status points at an enum (value type) → NOT navigation
    expect(byName.get('Status')?.isNavigation).toBe(false)
  })

  it('returns [] for an undefined model (graceful no-metadata)', () => {
    expect(propertiesFor(undefined)).toEqual([])
  })
})

describe('resolvePropertyPath', () => {
  it('resolves a direct property', () => {
    expect(resolvePropertyPath(makeDoc(), PET, 'Name')?.type).toBe('Edm.String')
  })
  it('resolves a navigation path Category/Title', () => {
    expect(resolvePropertyPath(makeDoc(), PET, 'Category/Title')?.type).toBe('Edm.String')
  })
  it('returns undefined for an unknown property', () => {
    expect(resolvePropertyPath(makeDoc(), PET, 'Nope')).toBeUndefined()
  })
})

describe('operatorsForType', () => {
  it('offers comparisons for a scalar but not has', () => {
    const ops = operatorsForType('Edm.Int32')
    expect(ops).toContain('eq')
    expect(ops).toContain('gt')
    expect(ops).not.toContain('has')
  })
  it('adds has for an enum property', () => {
    expect(operatorsForType(STATUS_ENUM, true)).toContain('has')
  })
})

describe('functionsForType', () => {
  it('offers string functions only for strings', () => {
    expect(functionsForType('Edm.String')).toContain('startswith')
    expect(functionsForType('Edm.Int32')).toEqual([])
  })
})

describe('isStringFunction', () => {
  it('recognises startswith', () => {
    expect(isStringFunction('startswith')).toBe(true)
    expect(isStringFunction('year')).toBe(false)
  })
})

describe('valueSuggestionsForProperty', () => {
  it('lists enum members as quoted literals (AC #3)', () => {
    const doc = makeDoc()
    const prop = doc.models[PET]?.properties.find((p) => p.name === 'Status')
    const vals = valueSuggestionsForProperty(prop, doc)
    expect(vals.map((v) => v.label)).toEqual(['Available', 'Pending', 'Sold'])
    expect(vals[0]?.insertText).toBe("'Available'")
  })

  it('falls back to a runtime enum field when enumValues absent', () => {
    const doc = makeDoc()
    // Drop the typed enumValues; simulate the importer-only `enum` field.
    const enumModel = doc.models[STATUS_ENUM] as { enumValues?: unknown[]; enum?: string[] }
    delete enumModel.enumValues
    enumModel.enum = ['A', 'B']
    const prop = doc.models[PET]?.properties.find((p) => p.name === 'Status')
    expect(valueSuggestionsForProperty(prop, doc).map((v) => v.label)).toEqual(['A', 'B'])
  })

  it('offers true/false for a boolean', () => {
    const doc = makeDoc()
    const prop = doc.models[PET]?.properties.find((p) => p.name === 'Active')
    expect(valueSuggestionsForProperty(prop, doc).map((v) => v.label)).toEqual(['true', 'false'])
  })

  it('offers a date-time snippet for a datetime property', () => {
    const doc = makeDoc()
    const prop = doc.models[PET]?.properties.find((p) => p.name === 'Created')
    expect(valueSuggestionsForProperty(prop, doc)[0]?.detail).toBe('date-time')
  })

  it('offers a GUID placeholder for a guid property', () => {
    const doc = makeDoc()
    const prop = doc.models[PET]?.properties.find((p) => p.name === 'Ref')
    expect(valueSuggestionsForProperty(prop, doc)[0]?.detail).toBe('guid')
  })

  it('offers no concrete values for a number / string', () => {
    const doc = makeDoc()
    const num = doc.models[PET]?.properties.find((p) => p.name === 'Id')
    const str = doc.models[PET]?.properties.find((p) => p.name === 'Name')
    expect(valueSuggestionsForProperty(num, doc)).toEqual([])
    expect(valueSuggestionsForProperty(str, doc)).toEqual([])
  })
})

describe('isOperatorValidForType (light validation)', () => {
  it('accepts eq/ne/in on any type', () => {
    expect(isOperatorValidForType('eq', 'Edm.String')).toBe(true)
    expect(isOperatorValidForType('in', 'Edm.Int32')).toBe(true)
  })
  it('rejects ordering on a boolean', () => {
    expect(isOperatorValidForType('gt', 'Edm.Boolean')).toBe(false)
  })
  it('accepts ordering on a number / date', () => {
    expect(isOperatorValidForType('gt', 'Edm.Int32')).toBe(true)
    expect(isOperatorValidForType('le', 'Edm.DateTimeOffset')).toBe(true)
  })
  it('has is valid only for an enum', () => {
    expect(isOperatorValidForType('has', STATUS_ENUM, true)).toBe(true)
    expect(isOperatorValidForType('has', 'Edm.Int32', false)).toBe(false)
  })
})
