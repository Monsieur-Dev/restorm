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
})
