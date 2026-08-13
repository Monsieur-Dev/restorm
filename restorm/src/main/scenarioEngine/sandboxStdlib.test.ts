// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildStdlibPreludeEntry, SANDBOX_LIBS } from './sandboxStdlib'

describe('buildStdlibPreludeEntry', () => {
  it('assigns every curated lib to its global', () => {
    const entry = buildStdlibPreludeEntry()
    for (const lib of SANDBOX_LIBS) {
      expect(entry).toContain(`globalThis.${lib.global} = `)
      expect(entry).toContain(`from '${lib.module}'`)
    }
  })

  it('routes every require name through the shim', () => {
    const entry = buildStdlibPreludeEntry()
    for (const lib of SANDBOX_LIBS) {
      for (const name of lib.requireNames) expect(entry).toContain(JSON.stringify(name))
    }
    expect(entry).toContain('globalThis.require')
  })

  it('aliases chai expect/assert as bare globals', () => {
    const entry = buildStdlibPreludeEntry()
    expect(entry).toContain('globalThis.expect')
    expect(entry).toContain('globalThis.assert')
  })
})
