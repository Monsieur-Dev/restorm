import { describe, it, expect, afterEach } from 'vitest'
import { coerceCliParamValue } from './scenarioCliParams'
import { installScenarioValueResolvers } from './scenarioValueResolvers'
import { setCustomListResolver, setEnvironmentPreviewResolver } from './utils/scenarioStaticPreview'
import { setEnumValuesResolver, setEnvironmentIdResolver } from './scenarioCliParams'
import type { FolderItem } from './types/folderTypes'

/** A minimal project: one env-folder with an enum, a custom list (Rouge→FF0000),
 * and two environments — `Staging` unique, `Dup` duplicated (ambiguous). */
const PROJECT = [
  {
    id: 'envf1',
    name: 'Service',
    folderType: 'environment',
    items: [],
    environments: [
      { id: 'env-staging', name: 'Staging', variables: [{ key: 'baseUrl', value: { type: 'string', value: 'http://s' } }] },
      { id: 'env-dup-1', name: 'Dup', variables: [] },
      { id: 'env-dup-2', name: 'Dup', variables: [] }
    ],
    enumDefinitions: [{ id: 'enum-status', name: 'Status', values: ['available', 'pending', 'sold'], matchingRules: [] }],
    customValueLists: [
      { id: 'list-colors', name: 'Pet Colors', entries: [
        { id: 'c1', label: 'Rouge', value: 'FF0000' },
        { id: 'c2', label: 'Vert', value: '00FF00' },
        { id: 'c3', label: 'Bleu', value: '0000FF' }
      ] }
    ]
  }
] as unknown as FolderItem[]

describe('coerceCliParamValue', () => {
  it('casts a numeric param to a real number', () => {
    expect(coerceCliParamValue('5', { type: 'numeric' })).toBe(5)
    expect(coerceCliParamValue('-3.5', { type: 'numeric' })).toBe(-3.5)
  })

  it('throws on a non-numeric value for a numeric param', () => {
    expect(() => coerceCliParamValue('abc', { type: 'numeric' })).toThrow(/number/i)
  })

  it('casts a boolean param (true/false/1/0/yes/no/on/off)', () => {
    for (const t of ['true', '1', 'yes', 'on', 'TRUE']) expect(coerceCliParamValue(t, { type: 'boolean' })).toBe(true)
    for (const f of ['false', '0', 'no', 'off', 'Off']) expect(coerceCliParamValue(f, { type: 'boolean' })).toBe(false)
  })

  it('throws on an unrecognized boolean value', () => {
    expect(() => coerceCliParamValue('maybe', { type: 'boolean' })).toThrow(/boolean/i)
  })

  it('parses a list param from JSON', () => {
    expect(coerceCliParamValue('[1,2,3]', { type: 'list' })).toEqual([1, 2, 3])
    expect(coerceCliParamValue('["a","b"]', { type: 'list' })).toEqual(['a', 'b'])
  })

  it('throws on non-array / invalid JSON for a list param', () => {
    expect(() => coerceCliParamValue('{"a":1}', { type: 'list' })).toThrow(/array/i)
    expect(() => coerceCliParamValue('not json', { type: 'list' })).toThrow(/JSON/i)
  })

  it('returns null for a null param', () => {
    expect(coerceCliParamValue('whatever', { type: 'null' })).toBeNull()
  })

  it('keeps the raw string for textual types (datetime stays its ISO string)', () => {
    expect(coerceCliParamValue('2030-01-15T08:30:00.000Z', { type: 'datetime' })).toBe('2030-01-15T08:30:00.000Z')
    expect(coerceCliParamValue('hello', { type: 'string' })).toBe('hello')
    expect(coerceCliParamValue('#ff0000', { type: 'color' })).toBe('#ff0000')
  })

  it('passes the raw string through when no valueType is known', () => {
    expect(coerceCliParamValue('x', undefined)).toBe('x')
    expect(coerceCliParamValue('x', null)).toBe('x')
    expect(coerceCliParamValue('x', {})).toBe('x')
  })
})

describe('coerceCliParamValue with project resolvers (enum / customList / environment)', () => {
  afterEach(() => {
    setCustomListResolver(null)
    setEnvironmentPreviewResolver(null)
    setEnumValuesResolver(null)
    setEnvironmentIdResolver(null)
  })

  it('validates an enum value against the allowed set', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(coerceCliParamValue('pending', { type: 'enum', enumDefinitionId: 'enum-status' })).toBe('pending')
    expect(() => coerceCliParamValue('nope', { type: 'enum', enumDefinitionId: 'enum-status' })).toThrow(/allowed enum/i)
  })

  it('splits an enumList and validates each', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(coerceCliParamValue('available, sold', { type: 'enumList', enumDefinitionId: 'enum-status' })).toEqual(['available', 'sold'])
    expect(() => coerceCliParamValue('available, nope', { type: 'enumList', enumDefinitionId: 'enum-status' })).toThrow(/allowed enum/i)
  })

  it('resolves a custom-list label to its value (Rouge → FF0000)', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(coerceCliParamValue('Rouge', { type: 'customList', listId: 'list-colors' })).toBe('FF0000')
    expect(coerceCliParamValue('Bleu', { type: 'customList', listId: 'list-colors' })).toBe('0000FF')
  })

  it('resolves a customListMulti of labels to an array of values', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(coerceCliParamValue('Rouge, Vert', { type: 'customListMulti', listId: 'list-colors' })).toEqual(['FF0000', '00FF00'])
  })

  it('resolves an environment by name to its { name, variables } value', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(coerceCliParamValue('Staging', { type: 'environment' })).toEqual({ name: 'Staging', variables: { baseUrl: 'http://s' } })
  })

  it('resolves an environment by id too', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(coerceCliParamValue('env-staging', { type: 'environment' })).toEqual({ name: 'Staging', variables: { baseUrl: 'http://s' } })
  })

  it('throws on an ambiguous environment name', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(() => coerceCliParamValue('Dup', { type: 'environment' })).toThrow(/ambiguous environment/i)
  })

  it('throws on an unknown environment', () => {
    installScenarioValueResolvers(() => PROJECT)
    expect(() => coerceCliParamValue('Ghost', { type: 'environment' })).toThrow(/unknown environment/i)
  })
})
