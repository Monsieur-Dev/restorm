import { describe, it, expect } from 'vitest'
import { serializeValueShape } from './serializeValueShape'
import { StringValue } from '../../../../shared/types/collections'
import { SecretValue } from '../../../../shared/types/valueTypes/SecretValue'

describe('serializeValueShape', () => {
  // Regression: the env-folder variables table only persists a cell edit when
  // the value's serialized shape changes. A secret whose params.name is edited
  // keeps the SAME toString() (resolved/empty), so a toString-based comparison
  // would treat it as "no change" and silently drop the edit. The serialized
  // shape must differ so the persist fires.
  it('changes when a secret param is edited (the toString stays the same)', () => {
    const before = new SecretValue('envVar', { name: 'OLD_NAME' })
    const after = new SecretValue('envVar', { name: 'NEW_NAME' })

    expect(before.toString()).toBe(after.toString()) // both '' — toString can't tell them apart
    expect(serializeValueShape(before)).not.toBe(serializeValueShape(after))
  })

  it('is stable for two equal secrets', () => {
    const a = new SecretValue('envVar', { name: 'TOKEN' })
    const b = new SecretValue('envVar', { name: 'TOKEN' })
    expect(serializeValueShape(a)).toBe(serializeValueShape(b))
  })

  it('never includes the resolved plaintext', () => {
    const v = new SecretValue('envVar', { name: 'TOKEN' })
    v.resolved = 'super-secret-plaintext'
    const shape = serializeValueShape(v)
    expect(shape).not.toContain('super-secret-plaintext')
    expect(shape).not.toContain('resolved')
  })

  it('distinguishes a recast (string -> secret) even with the same display string', () => {
    const str = new StringValue('')
    const secret = new SecretValue('envVar', { name: 'X' })
    expect(str.toString()).toBe(secret.toString()) // both ''
    expect(serializeValueShape(str)).not.toBe(serializeValueShape(secret))
  })
})
