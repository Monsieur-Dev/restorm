import { describe, it, expect } from 'vitest'
import { getContrastColor } from './colorContrast'

describe('getContrastColor', () => {
  it('returns white for dark backgrounds', () => {
    expect(getContrastColor('#000000')).toBe('#ffffff')
    expect(getContrastColor('#333333')).toBe('#ffffff')
    expect(getContrastColor('#1a1a2e')).toBe('#ffffff')
  })

  it('returns black for light backgrounds', () => {
    expect(getContrastColor('#ffffff')).toBe('#000000')
    expect(getContrastColor('#f0f0f0')).toBe('#000000')
    expect(getContrastColor('#ffcc00')).toBe('#000000')
  })

  it('handles hex without hash', () => {
    expect(getContrastColor('000000')).toBe('#ffffff')
    expect(getContrastColor('ffffff')).toBe('#000000')
  })

  it('handles 3-char hex shorthand', () => {
    expect(getContrastColor('#fff')).toBe('#000000')
    expect(getContrastColor('#000')).toBe('#ffffff')
  })

  it('returns white for typical orange button', () => {
    expect(getContrastColor('#c75000')).toBe('#ffffff')
  })

  it('returns black for pure red (luminance above threshold)', () => {
    expect(getContrastColor('#ff0000')).toBe('#000000')
  })

  it('returns black for pure green', () => {
    expect(getContrastColor('#00ff00')).toBe('#000000')
  })

  it('returns white for pure blue', () => {
    expect(getContrastColor('#0000ff')).toBe('#ffffff')
  })

  it('accepts hsl() strings', () => {
    // Yellow at hsl(60,65%,50%) is luminous enough that black reads best.
    expect(getContrastColor('hsl(60, 65%, 50%)')).toBe('#000000')
    // Blue at hsl(240,65%,50%) is dark enough that white reads best.
    expect(getContrastColor('hsl(240, 65%, 50%)')).toBe('#ffffff')
    // Pure black / white as HSL.
    expect(getContrastColor('hsl(0, 0%, 0%)')).toBe('#ffffff')
    expect(getContrastColor('hsl(0, 0%, 100%)')).toBe('#000000')
  })
})

describe('getContrastColor with computed colours', () => {
  it('parses the rgb() form getComputedStyle returns', () => {
    // Read off a rendered element, a colour arrives as `rgb(r, g, b)` — not as
    // the hex the caller originally wrote. Treating that as hex silently
    // produced the WRONG contrast rather than an error.
    expect(getContrastColor('rgb(199, 80, 0)')).toBe(getContrastColor('#c75000'))
    expect(getContrastColor('rgb(255, 255, 255)')).toBe('#000000')
    expect(getContrastColor('rgb(0, 0, 0)')).toBe('#ffffff')
  })

  it('parses rgba() and ignores the alpha channel', () => {
    expect(getContrastColor('rgba(255, 255, 255, 0.5)')).toBe('#000000')
    expect(getContrastColor('rgba(0, 0, 0, 1)')).toBe('#ffffff')
  })

  it('still resolves a colour sitting right on the luminance threshold', () => {
    // #c75000 lands at 0.1788 — just under the 0.179 cut, so it takes white.
    // A parser that mangles the input flips this to black, which is the exact
    // failure this guards.
    expect(getContrastColor('#c75000')).toBe('#ffffff')
    expect(getContrastColor('rgb(199, 80, 0)')).toBe('#ffffff')
  })
})
