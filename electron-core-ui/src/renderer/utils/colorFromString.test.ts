import { describe, it, expect } from 'vitest'
import { getColorFromString } from './colorFromString'
import { getContrastColor } from './colorContrast'

const HSL_RE = /^hsl\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/

describe('getColorFromString', () => {
  it('is deterministic: same input always yields the same output', () => {
    expect(getColorFromString('Pets')).toBe(getColorFromString('Pets'))
    expect(getColorFromString('Store')).toBe(getColorFromString('Store'))
    expect(getColorFromString('')).toBe(getColorFromString(''))
  })

  it('produces a valid hsl(...) string', () => {
    for (const s of ['Pets', 'Store', 'Users', 'foo', 'bar', '', '🎨 unicode']) {
      const out = getColorFromString(s)
      const match = HSL_RE.exec(out)
      if (!match) {
        throw new Error(`expected hsl(...) for input "${s}" but got "${out}"`)
      }
      const hue = Number(match[1])
      const sat = Number(match[2])
      const light = Number(match[3])
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(sat).toBeGreaterThanOrEqual(0)
      expect(sat).toBeLessThanOrEqual(100)
      expect(light).toBeGreaterThanOrEqual(0)
      expect(light).toBeLessThanOrEqual(100)
    }
  })

  it('maps different inputs to different hues (spot check)', () => {
    const hues = new Set<string>()
    for (const tag of ['Pets', 'Store', 'Users', 'Admin', 'Orders', 'Payments']) {
      const match = HSL_RE.exec(getColorFromString(tag))
      if (!match) throw new Error(`expected hsl(...) for tag "${tag}"`)
      hues.add(match[1] ?? '')
    }
    // Not strictly guaranteed, but for these six short inputs the FNV-1a
    // hash produces distinct hues — if this ever regresses, investigate
    // the hash rather than relaxing the assertion.
    expect(hues.size).toBe(6)
  })

  it('produces hues spread across the wheel for a bulk sample', () => {
    const hues: number[] = []
    for (let i = 0; i < 64; i++) {
      const match = HSL_RE.exec(getColorFromString(`tag-${i}`))
      if (!match) throw new Error(`expected hsl(...) for "tag-${i}"`)
      hues.push(Number(match[1]))
    }
    const unique = new Set(hues).size
    // Allow occasional hash collisions but require a healthy spread.
    expect(unique).toBeGreaterThan(50)
    // Cover at least half of the 360° wheel (range ≥ 180°).
    expect(Math.max(...hues) - Math.min(...hues)).toBeGreaterThan(180)
  })

  it('getContrastColor returns a readable overlay for hashed colors', () => {
    for (const tag of ['Pets', 'Store', 'Users', 'Admin', 'Orders', 'A', 'B', 'C', 'Z']) {
      const color = getColorFromString(tag)
      const contrast = getContrastColor(color)
      expect([contrast]).toSatisfy((v: string[]) => v[0] === '#000000' || v[0] === '#ffffff')
    }
  })
})
