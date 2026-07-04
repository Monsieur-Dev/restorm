import { describe, it, expect } from 'vitest'
import { parseFreeformCommand, capXreadBlockMs, formatRedisReply, describeRedisConnectError } from './redisCommand'

describe('parseFreeformCommand', () => {
  it('splits on whitespace', () => {
    expect(parseFreeformCommand('SET foo bar')).toEqual(['SET', 'foo', 'bar'])
  })

  it('honours double- and single-quoted segments carrying spaces', () => {
    expect(parseFreeformCommand('SET foo "bar baz"')).toEqual(['SET', 'foo', 'bar baz'])
    expect(parseFreeformCommand("SET foo 'bar baz'")).toEqual(['SET', 'foo', 'bar baz'])
  })

  it('collapses repeated whitespace', () => {
    expect(parseFreeformCommand('GET   foo')).toEqual(['GET', 'foo'])
  })

  it('returns an empty array for a blank line', () => {
    expect(parseFreeformCommand('')).toEqual([])
    expect(parseFreeformCommand('   ')).toEqual([])
  })
})

describe('capXreadBlockMs', () => {
  it('caps an unbounded BLOCK 0 at the ceiling', () => {
    expect(capXreadBlockMs(['STREAMS', 'mystream', '$', 'BLOCK', '0'], 5000)).toEqual(['STREAMS', 'mystream', '$', 'BLOCK', '5000'])
  })

  it('caps a BLOCK value larger than the ceiling', () => {
    expect(capXreadBlockMs(['BLOCK', '60000'], 5000)).toEqual(['BLOCK', '5000'])
  })

  it('leaves a BLOCK value under the ceiling untouched', () => {
    expect(capXreadBlockMs(['BLOCK', '1000'], 5000)).toEqual(['BLOCK', '1000'])
  })

  it('is case-insensitive on the BLOCK keyword', () => {
    expect(capXreadBlockMs(['block', '0'], 5000)).toEqual(['block', '5000'])
  })

  it('is a no-op when BLOCK is absent', () => {
    const args = ['STREAMS', 'mystream', '$']
    expect(capXreadBlockMs(args, 5000)).toEqual(args)
  })

  it('is a no-op when BLOCK is the last token (no value follows)', () => {
    expect(capXreadBlockMs(['STREAMS', 'mystream', 'BLOCK'], 5000)).toEqual(['STREAMS', 'mystream', 'BLOCK'])
  })
})

describe('formatRedisReply', () => {
  it('formats nil as (nil)', () => {
    expect(formatRedisReply(null)).toBe('(nil)')
    expect(formatRedisReply(undefined)).toBe('(nil)')
  })

  it('formats strings and numbers as-is', () => {
    expect(formatRedisReply('bar')).toBe('bar')
    expect(formatRedisReply(42)).toBe('42')
  })

  it('formats a Buffer as its UTF-8 string', () => {
    expect(formatRedisReply(Buffer.from('hello'))).toBe('hello')
  })

  it('formats an array reply as JSON', () => {
    expect(formatRedisReply(['a', 'b', 1])).toBe('["a","b",1]')
  })

  it('falls back to a sentinel for a value JSON.stringify cannot serialize', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(formatRedisReply(circular)).toBe('(unserializable reply)')
  })
})

describe('describeRedisConnectError', () => {
  it('maps known error codes to actionable messages', () => {
    expect(describeRedisConnectError({ code: 'ECONNREFUSED' }, 'redis://localhost:6379')).toMatch(/Connection refused/)
    expect(describeRedisConnectError({ code: 'ENOTFOUND' }, 'redis://bad-host')).toMatch(/Host not found/)
    expect(describeRedisConnectError({ code: 'ETIMEDOUT' }, 'redis://localhost:6379')).toMatch(/timed out/)
    expect(describeRedisConnectError({ code: 'ECONNRESET' }, 'redis://localhost:6379')).toMatch(/reset/)
    expect(describeRedisConnectError({ code: 'WRONGPASS' }, 'redis://localhost:6379')).toMatch(/Authentication failed/)
    expect(describeRedisConnectError({ code: 'NOAUTH' }, 'redis://localhost:6379')).toMatch(/Authentication failed/)
  })

  it('falls back to the raw message for an unknown code', () => {
    expect(describeRedisConnectError({ message: 'something odd' }, 'redis://localhost:6379')).toBe('something odd')
  })

  it('falls back to a generic message when nothing is available', () => {
    expect(describeRedisConnectError({}, 'redis://localhost:6379')).toMatch(/Redis connection failed/)
  })
})
