import { describe, it, expect } from 'vitest'
import { isPickableEntry } from './customValueEntries'

// Everything that turns custom-value entries into choices — the value
// dropdown, the multi-select, the switch-node cycle, the seed a type recast
// picks — has to agree on what counts as one. The entries editor keeps an
// empty row as a typing affordance and stores a blank row left among filled
// ones, so a label-less entry is a shape those consumers really do receive.

describe('isPickableEntry', () => {
  it('offers an ordinary entry', () => {
    expect(isPickableEntry({ label: 'Rouge', enabled: true })).toBe(true)
  })

  it('offers an entry whose enabled flag is absent — the default is on', () => {
    expect(isPickableEntry({ label: 'Rouge' })).toBe(true)
  })

  it('refuses a disabled entry', () => {
    expect(isPickableEntry({ label: 'Rouge', enabled: false })).toBe(false)
  })

  it('refuses an entry with no label — it would be a blank line selecting nothing', () => {
    expect(isPickableEntry({ label: '', enabled: true })).toBe(false)
  })

  it('refuses a label that is only whitespace, which reads as blank on screen', () => {
    expect(isPickableEntry({ label: '   ', enabled: true })).toBe(false)
  })
})
