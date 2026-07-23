// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  measureCodiconOpticalOffset,
  getCodiconOpticalOffset,
  clearCodiconOpticalOffsetCache
} from './codiconOpticalCentre'

const FONT_PX = 18
const SUPERSAMPLE = 8
const PX = FONT_PX * SUPERSAMPLE
const EXTENT = PX * 2

/** Paint a solid block of ink into a fake glyph raster, so the centroid the
 * code computes is known exactly. Coordinates are supersampled canvas px. */
const inkBlock = (x0: number, x1: number, y0: number, y1: number): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(EXTENT * EXTENT * 4)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      data[(y * EXTENT + x) * 4 + 3] = 255
    }
  }
  return data
}

let raster: Uint8ClampedArray
let getContextCalls = 0
let canvasAvailable = true
let advanceWidth = PX

const fakeContext = (): unknown => ({
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  measureText: () => ({ width: advanceWidth }),
  fillText: () => undefined,
  getImageData: () => ({ data: raster })
})

beforeEach(() => {
  clearCodiconOpticalOffsetCache()
  // The glyph class → character lookup reads the `::before` content, which
  // jsdom reports as the empty string; stub it to a real character.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () => ({ content: '""' }) as unknown as CSSStyleDeclaration
  )
  Object.defineProperty(document, 'fonts', {
    value: { check: () => true, ready: Promise.resolve() },
    configurable: true
  })
  getContextCalls = 0
  canvasAvailable = true
  advanceWidth = PX
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((): unknown => {
    getContextCalls += 1
    return canvasAvailable ? fakeContext() : null
  }) as never)
})

afterEach(() => { vi.restoreAllMocks() })

describe('codicon optical centring', () => {
  it('returns the offset that moves the ink centroid onto the box centre', () => {
    // The box the glyph is centred in spans the advance width on the baseline;
    // its centre lands at (PX, PX) in the supersampled raster. Ink is painted
    // 15 supersampled px to the RIGHT of it, so the glyph must move LEFT.
    raster = inkBlock(PX + 10, PX + 20, PX - 5, PX + 5)
    const offset = measureCodiconOpticalOffset('send', FONT_PX)
    expect(offset).not.toBeNull()
    expect(offset?.dx).toBeCloseTo(-2, 5)
    expect(offset?.dy).toBeCloseTo(0, 5)
  })

  it('reports no offset for ink already centred on the box', () => {
    raster = inkBlock(PX - 20, PX + 20, PX - 20, PX + 20)
    const offset = measureCodiconOpticalOffset('close', FONT_PX)
    expect(offset).toEqual({ dx: 0, dy: 0 })
  })

  it('snaps the offset to the half-pixel grid', () => {
    // Centroid 5 supersampled px off centre = 0.625 CSS px, which must land on
    // 0.5 rather than blurring the glyph across a pixel boundary.
    raster = inkBlock(PX + 4, PX + 6, PX - 1, PX + 1)
    const offset = measureCodiconOpticalOffset('run', FONT_PX)
    expect(offset?.dx).toBe(-0.5)
  })

  it('declines to measure while the codicon font is not loaded', () => {
    // A codicon always advances exactly one em; anything else means a fallback
    // face was substituted, and rasterising it would produce offsets for a
    // different shape entirely.
    advanceWidth = PX * 0.62
    raster = inkBlock(PX + 10, PX + 20, PX - 5, PX + 5)
    expect(measureCodiconOpticalOffset('send', FONT_PX)).toBeNull()
  })

  it('declines to measure when no 2d canvas is available', () => {
    canvasAvailable = false
    raster = inkBlock(PX + 10, PX + 20, PX - 5, PX + 5)
    expect(measureCodiconOpticalOffset('send', FONT_PX)).toBeNull()
  })

  it('measures a glyph once, and does not cache a failure', () => {
    raster = inkBlock(PX + 10, PX + 20, PX - 5, PX + 5)
    expect(getCodiconOpticalOffset('send', FONT_PX)?.dx).toBeCloseTo(-2, 5)
    const callsAfterFirst = getContextCalls
    expect(getCodiconOpticalOffset('send', FONT_PX)?.dx).toBeCloseTo(-2, 5)
    expect(getContextCalls).toBe(callsAfterFirst)

    // A failure must stay un-cached, otherwise a glyph measured before the
    // font arrived would remain uncentred for the whole session.
    clearCodiconOpticalOffsetCache()
    canvasAvailable = false
    expect(getCodiconOpticalOffset('plug', FONT_PX)).toBeNull()
    canvasAvailable = true
    expect(getCodiconOpticalOffset('plug', FONT_PX)?.dx).toBeCloseTo(-2, 5)
  })

  it('keeps measurements for the two disc sizes apart', () => {
    raster = inkBlock(PX + 10, PX + 20, PX - 5, PX + 5)
    getCodiconOpticalOffset('send', FONT_PX)
    const callsAfterFirst = getContextCalls
    getCodiconOpticalOffset('send', 14)
    expect(getContextCalls).toBeGreaterThan(callsAfterFirst)
  })
})
