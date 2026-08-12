import { describe, it, expect } from 'vitest'
import { KEY_SEP } from './inputBuffer'

/**
 * The composite latch key joins a token's source identity and its scope key
 * with a single separator. That separator MUST be U+0000 (NUL): it is the one
 * byte that can never appear inside `${fromNodeId}:${fromPort}` or a scope key,
 * so two distinct tokens can never collide on one latch key. The separator is
 * written in source as the `\0` escape (not a raw NUL byte) so the file stays
 * plain text and diffable — this test guards that the runtime value is still
 * exactly NUL regardless of how it is spelled in source.
 */
describe('inputBuffer KEY_SEP', () => {
  it('is a single U+0000 (NUL) character', () => {
    expect(KEY_SEP).toBe('\0')
    expect(KEY_SEP).toHaveLength(1)
    expect(KEY_SEP.charCodeAt(0)).toBe(0)
  })
})
