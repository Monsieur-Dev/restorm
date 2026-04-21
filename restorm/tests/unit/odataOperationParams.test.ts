import { describe, it, expect } from 'vitest'
import {
  buildActionBodyObject,
  buildFunctionInlinedArgs,
  serializeFunctionArgValue
} from '../../src/shared/utils/odataOperationParams'
import type { ODataOperationParameterSpec } from '../../src/shared/types/collections'

describe('serializeFunctionArgValue', () => {
  it('quotes strings and escapes single quotes', () => {
    expect(serializeFunctionArgValue('Edm.String', "O'Brien")).toBe("'O''Brien'")
  })
  it('emits numeric types unquoted', () => {
    expect(serializeFunctionArgValue('Edm.Int32', '42')).toBe('42')
    expect(serializeFunctionArgValue('Edm.Double', '3.14')).toBe('3.14')
  })
  it('emits booleans as lower-case literals', () => {
    expect(serializeFunctionArgValue('Edm.Boolean', 'true')).toBe('true')
    expect(serializeFunctionArgValue('Edm.Boolean', 'FALSE')).toBe('false')
  })
  it('emits GUIDs bare', () => {
    expect(serializeFunctionArgValue('Edm.Guid', '11111111-2222-3333-4444-555555555555'))
      .toBe('11111111-2222-3333-4444-555555555555')
  })
  it('returns null for missing / empty values', () => {
    expect(serializeFunctionArgValue('Edm.Int32', undefined)).toBe('null')
    expect(serializeFunctionArgValue('Edm.String', '')).toBe('null')
  })
})

describe('buildFunctionInlinedArgs', () => {
  it('joins non-binding parameters into parentheses', () => {
    const params: ODataOperationParameterSpec[] = [
      { name: 'category', type: 'Edm.String', value: 'Dogs' },
      { name: 'age', type: 'Edm.Int32', value: '3' }
    ]
    expect(buildFunctionInlinedArgs(params)).toBe("(category='Dogs',age=3)")
  })
  it('skips binding parameters', () => {
    const params: ODataOperationParameterSpec[] = [
      { name: 'bindingParameter', type: 'Pet', isBinding: true, value: 'ignored' },
      { name: 'status', type: 'Edm.String', value: 'Available' }
    ]
    expect(buildFunctionInlinedArgs(params)).toBe("(status='Available')")
  })
  it('returns empty string when no parameters remain', () => {
    expect(buildFunctionInlinedArgs([])).toBe('')
    expect(buildFunctionInlinedArgs([{ name: 'self', type: 'Pet', isBinding: true }])).toBe('')
  })
})

describe('buildActionBodyObject', () => {
  it('parses numeric / boolean / string values', () => {
    const params: ODataOperationParameterSpec[] = [
      { name: 'OwnerId', type: 'Edm.Int32', value: '42' },
      { name: 'Notify', type: 'Edm.Boolean', value: 'true' },
      { name: 'Note', type: 'Edm.String', value: 'Welcome' }
    ]
    expect(buildActionBodyObject(params)).toEqual({
      OwnerId: 42,
      Notify: true,
      Note: 'Welcome'
    })
  })
  it('skips binding parameters', () => {
    const params: ODataOperationParameterSpec[] = [
      { name: 'bindingParameter', type: 'Pet', isBinding: true, value: 'x' },
      { name: 'Count', type: 'Edm.Int32', value: '5' }
    ]
    expect(buildActionBodyObject(params)).toEqual({ Count: 5 })
  })
  it('skips missing / empty values (server defaults win)', () => {
    const params: ODataOperationParameterSpec[] = [
      { name: 'A', type: 'Edm.Int32' },
      { name: 'B', type: 'Edm.String', value: '' },
      { name: 'C', type: 'Edm.Int32', value: '0' }
    ]
    expect(buildActionBodyObject(params)).toEqual({ C: 0 })
  })
})
