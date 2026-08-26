import { describe, it, expect } from 'vitest'
import { threeWayMerge } from '../../src/shared/design/threeWayMerge'

describe('threeWayMerge', () => {
  it('returns theirs when only the template changed (base === ours)', () => {
    const base = 'a\nb\nc\n'
    const theirs = 'a\nB\nc\n'
    expect(threeWayMerge(base, base, theirs)).toEqual({ text: theirs, conflict: false })
  })

  it('returns ours when only the user changed (base === theirs)', () => {
    const base = 'a\nb\nc\n'
    const ours = 'a\nEDIT\nc\n'
    expect(threeWayMerge(base, ours, base)).toEqual({ text: ours, conflict: false })
  })

  it('returns the identical text when both sides made the same change', () => {
    const base = 'a\nb\nc'
    const same = 'a\nX\nc'
    expect(threeWayMerge(base, same, same)).toEqual({ text: same, conflict: false })
  })

  it('combines non-overlapping edits from both sides', () => {
    // User edits line 2, template edits line 5 — both must survive.
    const base = 'l1\nl2\nl3\nl4\nl5'
    const ours = 'l1\nUSER\nl3\nl4\nl5'
    const theirs = 'l1\nl2\nl3\nl4\nTEMPLATE'
    const { text, conflict } = threeWayMerge(base, ours, theirs)
    expect(conflict).toBe(false)
    expect(text).toBe('l1\nUSER\nl3\nl4\nTEMPLATE')
  })

  it('keeps a user-added line and a template-added line (disjoint insertions)', () => {
    const base = 'header\nbody\nfooter'
    const ours = 'header\nbody\nfooter\n// user note'
    const theirs = 'header\n// generated\nbody\nfooter'
    const { text, conflict } = threeWayMerge(base, ours, theirs)
    expect(conflict).toBe(false)
    expect(text).toContain('// generated')
    expect(text).toContain('// user note')
    expect(text).toContain('body')
  })

  it('marks a genuine conflict when both sides change the same line differently', () => {
    const base = 'a\nshared\nc'
    const ours = 'a\nMINE\nc'
    const theirs = 'a\nTHEIRS\nc'
    const { text, conflict } = threeWayMerge(base, ours, theirs)
    expect(conflict).toBe(true)
    expect(text).toContain('<<<<<<< current')
    expect(text).toContain('MINE')
    expect(text).toContain('=======')
    expect(text).toContain('THEIRS')
    expect(text).toContain('>>>>>>> generated')
  })
})
