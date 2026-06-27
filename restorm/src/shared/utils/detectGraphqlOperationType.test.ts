import { describe, it, expect } from 'vitest'
import { detectGraphqlOperationType, isSubscriptionOperation } from './detectGraphqlOperationType'

describe('detectGraphqlOperationType', () => {
  it('detects an explicit subscription operation', () => {
    expect(detectGraphqlOperationType('subscription OnTick { ticks }')).toBe('subscription')
    expect(isSubscriptionOperation('subscription { ticks }')).toBe(true)
  })

  it('detects query and mutation', () => {
    expect(detectGraphqlOperationType('query Pets { pets }')).toBe('query')
    expect(detectGraphqlOperationType('mutation AddPet { addPet(name: "Rex") }')).toBe('mutation')
  })

  it('treats anonymous shorthand and empty input as query', () => {
    expect(detectGraphqlOperationType('{ pets }')).toBe('query')
    expect(detectGraphqlOperationType('')).toBe('query')
    expect(detectGraphqlOperationType('   \n  ')).toBe('query')
  })

  it('is case-insensitive and tolerant of leading whitespace/newlines', () => {
    expect(detectGraphqlOperationType('\n\n  SUBSCRIPTION OnTick { ticks }')).toBe('subscription')
  })

  it('ignores a keyword that only appears inside a comment', () => {
    expect(detectGraphqlOperationType('# subscription is what we want\nquery { pets }')).toBe('query')
  })

  it('does not match a keyword that is only a prefix of a field name', () => {
    // `subscriptions` (plural) as a field of a shorthand query must NOT be read
    // as a subscription operation — the \b word boundary guards this.
    expect(detectGraphqlOperationType('{ subscriptions }')).toBe('query')
  })
})
