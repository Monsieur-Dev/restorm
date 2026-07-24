import { describe, it, expect } from 'vitest'
import { generateSessionName, generateUniqueSessionName } from './sessionNameGenerator'

describe('generateSessionName', () => {
  it('returns a lower-kebab adjective-animal pair', () => {
    const name = generateSessionName()
    expect(name).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('returns different names on subsequent calls (probabilistic)', () => {
    // Drawing 10 names from ~500k combinations: the probability of all being
    // identical is negligible. Deterministically, the generator has no seed.
    const names = Array.from({ length: 10 }, (): string => generateSessionName())
    const unique = new Set(names)
    expect(unique.size).toBeGreaterThan(1)
  })
})

describe('generateUniqueSessionName', () => {
  const make =
    (name: string): (() => string) =>
    (): string =>
      name

  it('returns the generated name when there are no existing names', () => {
    expect(generateUniqueSessionName([], undefined, make('lucky-unicorn'))).toBe('lucky-unicorn')
  })

  it('appends worktree suffix with @ in dev mode', () => {
    expect(generateUniqueSessionName([], 'my-worktree', make('lucky-unicorn'))).toBe('lucky-unicorn@my-worktree')
  })

  it('re-draws on collision and returns the second draw', () => {
    let calls = 0
    const gen = (): string => (++calls === 1 ? 'lucky-unicorn' : 'brave-panda')
    expect(generateUniqueSessionName(['lucky-unicorn'], undefined, gen)).toBe('brave-panda')
    expect(calls).toBe(2)
  })

  it('re-draws on collision with worktree suffix', () => {
    let calls = 0
    const gen = (): string => (++calls === 1 ? 'lucky-unicorn' : 'brave-panda')
    expect(generateUniqueSessionName(['lucky-unicorn@my-worktree'], 'my-worktree', gen)).toBe('brave-panda@my-worktree')
  })

  it('falls back to numeric suffix after MAX_RETRIES collisions', () => {
    // All draws return the same base — forces the numeric-suffix path.
    const gen = make('brave-panda')
    const existing = ['brave-panda', 'brave-panda-2', 'brave-panda-3']
    expect(generateUniqueSessionName(existing, undefined, gen)).toBe('brave-panda-4')
  })

  it('omits the @ separator when the worktree suffix is empty or blank', () => {
    // The DEV suffix falls back to `basename(process.cwd())`, which is '' when
    // the process was started with cwd `/` (e.g. via macOS `open`). A dangling
    // `name@` was showing in the status bar.
    expect(generateUniqueSessionName([], '', make('lucky-unicorn'))).toBe('lucky-unicorn')
    expect(generateUniqueSessionName([], '   ', make('lucky-unicorn'))).toBe('lucky-unicorn')
  })

  it('numeric suffix also respects worktree suffix', () => {
    const gen = make('brave-panda')
    const existing = ['brave-panda@wt', 'brave-panda-2@wt']
    expect(generateUniqueSessionName(existing, 'wt', gen)).toBe('brave-panda-3@wt')
  })

  it('returns a collision-free name even with a large occupied set', () => {
    const gen = make('calm-eagle')
    const existing = Array.from({ length: 10 }, (_, i): string => (i === 0 ? 'calm-eagle' : `calm-eagle-${String(i + 1)}`))
    const result = generateUniqueSessionName(existing, undefined, gen)
    expect(existing).not.toContain(result)
    expect(result).toMatch(/^calm-eagle-\d+$/)
  })
})
