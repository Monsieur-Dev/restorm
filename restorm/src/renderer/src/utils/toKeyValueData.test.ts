import { describe, it, expect } from 'vitest'
import { toKeyValueData } from './toKeyValueData'
import { StringValue, ExpressionValue } from '../../../shared/types/valueTypes'
import { SecretValue } from '../../../shared/types/valueTypes/SecretValue'
import type { KeyValue } from '../../../shared/types/baseTypes'

describe('toKeyValueData', () => {
  it('flattens a StringValue to a verbatim string with no type bit', () => {
    const rows: KeyValue[] = [{ key: 'Accept', value: new StringValue('application/json'), enabled: true }]
    expect(toKeyValueData(rows)).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }])
  })

  it('marks an ExpressionValue with isExpression', () => {
    const rows: KeyValue[] = [{ key: 'Authorization', value: new ExpressionValue('{{token}}'), enabled: true }]
    const out = toKeyValueData(rows)
    const row = out[0]
    expect(row).toBeDefined()
    expect(row?.isExpression).toBe(true)
    expect(row?.value).toBe('{{token}}')
  })

  it('ships a SecretValue source + params and an empty value (plaintext never serialised)', () => {
    const secret = new SecretValue('envVar', { name: 'API_KEY' })
    // Even if a resolved plaintext leaked into the renderer model, the
    // serialised value must stay empty — only source + params travel.
    secret.resolved = 'should-not-be-sent'
    const rows: KeyValue[] = [{ key: 'X-Api-Key', value: secret, enabled: true }]
    const out = toKeyValueData(rows)
    const row = out[0]
    expect(row).toBeDefined()
    expect(row?.secret).toEqual({ source: 'envVar', params: { name: 'API_KEY' } })
    expect(row?.value).toBe('')
    expect(row?.isExpression).toBeUndefined()
  })
})
