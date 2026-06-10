import { describe, it, expect } from 'vitest'
import { applyXml, isXmlOp, XML_OPS } from './scenarioXml'

describe('scenarioXml — the one XML core (runtime + preview)', () => {
  it('parse: an XML string → an object (attributes under @_)', () => {
    expect(applyXml('<note id="1"><to>Tove</to><from>Jani</from></note>', 'parse')).toEqual({
      note: { '@_id': '1', to: 'Tove', from: 'Jani' }
    })
  })

  it('parse: an already-structured (non-string) value passes through (idempotent)', () => {
    const obj = { a: 1 }
    expect(applyXml(obj, 'parse')).toBe(obj)
  })

  it('parse: malformed XML THROWS (→ error port)', () => {
    expect(() => applyXml('<a><b></a>', 'parse')).toThrow(/Invalid XML/)
    expect(() => applyXml('<<>>', 'parse')).toThrow()
  })

  it('stringify: an object → an XML string; round-trips parse', () => {
    const xml = applyXml({ note: { '@_id': '1', to: 'Tove' } }, 'stringify')
    expect(xml).toBe('<note id="1"><to>Tove</to></note>')
    expect(applyXml(xml, 'parse')).toEqual({ note: { '@_id': '1', to: 'Tove' } })
  })

  it('stringify: indent pretty-prints', () => {
    const xml = applyXml({ root: { a: '1' } }, 'stringify', 2)
    expect(xml).toBe('<root>\n  <a>1</a>\n</root>')
  })

  it('isXmlOp guards the union', () => {
    expect(XML_OPS).toEqual(['parse', 'stringify'])
    expect(isXmlOp('parse')).toBe(true)
    expect(isXmlOp('build')).toBe(false)
  })
})
