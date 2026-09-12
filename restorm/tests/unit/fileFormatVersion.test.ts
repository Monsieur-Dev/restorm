import { describe, it, expect, vi } from 'vitest'
import {
  BASE_FILE_FORMAT_VERSION,
  CURRENT_FILE_FORMAT_VERSION,
  DESIGN_FILE_FORMAT_VERSION,
  RECORDING_FILE_FORMAT_VERSION,
  FILE_FORMAT_MISSING_CODE,
  FILE_FORMAT_VERSION_KEY,
  checkFileFormatCompatibility,
  requiredFileFormatVersion,
  resolveFileFormatVersion,
} from '../../src/shared/config/fileFormatVersion'
import { EnvironmentFolder } from '../../src/shared/models/EnvironmentFolder'
import { prepareForSerialization } from '../../src/shared/utils/serialization'
import { serialize } from 'electron-core-ui/main'

const silentLogger = { warn: (): void => { /* quiet */ } }

/** A collection root as it appears inside `collections`. */
const collection = (version?: unknown): Record<string, unknown> => {
  const root: Record<string, unknown> = { folderType: 'environment', id: 'x', name: 'C' }
  if (version !== undefined) root[FILE_FORMAT_VERSION_KEY] = version
  return root
}

/** A parsed document with the version at its root — the current shape. */
const documentAtRoot = (version?: unknown, collections: unknown[] = [collection()]): Record<string, unknown> => {
  const doc: Record<string, unknown> = { collections }
  if (version !== undefined) doc[FILE_FORMAT_VERSION_KEY] = version
  return doc
}

describe('CURRENT_FILE_FORMAT_VERSION', () => {
  it('is 1.2 — the recording-session format, the highest this build writes', () => {
    expect(BASE_FILE_FORMAT_VERSION).toBe(1)
    expect(DESIGN_FILE_FORMAT_VERSION).toBe(1.1)
    expect(RECORDING_FILE_FORMAT_VERSION).toBe(1.2)
    expect(CURRENT_FILE_FORMAT_VERSION).toBe(RECORDING_FILE_FORMAT_VERSION)
  })
})

describe('requiredFileFormatVersion — the lazy bump', () => {
  const design = { type: 'design', id: 'd1', name: 'API' }

  it('empty collections require the base version', () => {
    expect(requiredFileFormatVersion([])).toBe(BASE_FILE_FORMAT_VERSION)
  })

  it('a design-less tree requires the base version', () => {
    expect(requiredFileFormatVersion([collection()])).toBe(BASE_FILE_FORMAT_VERSION)
  })

  it('a design at the root requires the design version', () => {
    expect(requiredFileFormatVersion([collection(), design])).toBe(DESIGN_FILE_FORMAT_VERSION)
  })

  it('a design nested in a folder requires the design version', () => {
    const folder = { ...collection(), items: [{ id: 'f', name: 'sub', items: [design], configuration: {} }] }
    expect(requiredFileFormatVersion([folder])).toBe(DESIGN_FILE_FORMAT_VERSION)
  })

  it('removing the last design moves the requirement back down', () => {
    const withDesign = [collection(), design]
    expect(requiredFileFormatVersion(withDesign)).toBe(DESIGN_FILE_FORMAT_VERSION)
    expect(requiredFileFormatVersion(withDesign.filter((i) => i !== design))).toBe(BASE_FILE_FORMAT_VERSION)
  })

  it('a request `type` is not mistaken for a design', () => {
    const request = { type: 'http', id: 'r', name: 'GET pets', url: 'https://x' }
    expect(requiredFileFormatVersion([{ ...collection(), items: [request] }])).toBe(BASE_FILE_FORMAT_VERSION)
  })

  it('an older build refuses a document at the design version (the gate this bump exists for)', () => {
    // From the point of view of a build whose CURRENT is 1: 1.1 > 1.
    expect(DESIGN_FILE_FORMAT_VERSION).toBeGreaterThan(BASE_FILE_FORMAT_VERSION)
  })

  const recording = { type: 'recording', id: 's1', name: 'Petstore session', url: 'http://localhost:8080/', protocols: ['http'], whitelist: [], blacklist: [] }

  it('a recording session at the root requires the recording version', () => {
    expect(requiredFileFormatVersion([collection(), recording])).toBe(RECORDING_FILE_FORMAT_VERSION)
  })

  it('a recording session nested in a folder requires the recording version', () => {
    const folder = { ...collection(), items: [{ id: 'f', name: 'sub', items: [recording], configuration: {} }] }
    expect(requiredFileFormatVersion([folder])).toBe(RECORDING_FILE_FORMAT_VERSION)
  })

  it('the highest requirement wins when a design and a session coexist', () => {
    expect(requiredFileFormatVersion([design, recording])).toBe(RECORDING_FILE_FORMAT_VERSION)
    expect(requiredFileFormatVersion([recording, design])).toBe(RECORDING_FILE_FORMAT_VERSION)
  })

  it('removing the last session moves the requirement back down to what remains', () => {
    const both = [collection(), design, recording]
    expect(requiredFileFormatVersion(both.filter((i) => i !== recording))).toBe(DESIGN_FILE_FORMAT_VERSION)
    expect(requiredFileFormatVersion(both.filter((i) => i !== recording && i !== design))).toBe(BASE_FILE_FORMAT_VERSION)
  })

  it('a design-era build refuses a document at the recording version', () => {
    // From the point of view of a build whose CURRENT is 1.1: 1.2 > 1.1.
    expect(RECORDING_FILE_FORMAT_VERSION).toBeGreaterThan(DESIGN_FILE_FORMAT_VERSION)
  })

  it('a deduced request inside a session does not lower the requirement', () => {
    const withRoutes = { ...recording, items: [{ id: 'f', name: 'api', configuration: {}, items: [{ type: 'http', id: 'r', name: 'GET pets', url: 'http://localhost:8080/api/pets' }] }] }
    expect(requiredFileFormatVersion([withRoutes])).toBe(RECORDING_FILE_FORMAT_VERSION)
  })
})

describe('the version is not carried by a collection', () => {
  it('a new EnvironmentFolder has no version of its own', () => {
    const folder = new EnvironmentFolder({ name: 'Test' })
    expect(FILE_FORMAT_VERSION_KEY in folder).toBe(false)
  })

  it('toPlainObject() emits no version, so a save cannot put one back on a collection', () => {
    const folder = new EnvironmentFolder({ name: 'Test' })
    expect(Object.keys(folder.toPlainObject())).not.toContain(FILE_FORMAT_VERSION_KEY)
  })

  it('fromPlain() drops a version a document written before the move carries', () => {
    const legacy = {
      id: 'folder-1',
      name: 'Legacy',
      folderType: 'environment' as const,
      [FILE_FORMAT_VERSION_KEY]: 1
    }
    const folder = EnvironmentFolder.fromPlain(legacy as Parameters<typeof EnvironmentFolder.fromPlain>[0])
    expect(FILE_FORMAT_VERSION_KEY in folder).toBe(false)
    expect(Object.keys(folder.toPlainObject())).not.toContain(FILE_FORMAT_VERSION_KEY)
  })
})

describe('checkFileFormatCompatibility', () => {
  it('accepts the current version at the document root', () => {
    const result = checkFileFormatCompatibility(documentAtRoot(CURRENT_FILE_FORMAT_VERSION))
    expect(result.supported).toBe(true)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION)
    expect(result.current).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('accepts an older version', () => {
    expect(checkFileFormatCompatibility(documentAtRoot(CURRENT_FILE_FORMAT_VERSION - 1)).supported).toBe(true)
  })

  it('refuses a document that declares no version anywhere', () => {
    // Every document Restorm writes carries one, so "none" means the file
    // came from something else — there is nothing to read it AS.
    const result = checkFileFormatCompatibility(documentAtRoot())
    expect(result.supported).toBe(false)
    expect(result.code).toBe(FILE_FORMAT_MISSING_CODE)
    expect(result.found).toBeNull()
  })

  it('refuses a malformed version as a missing one, not as a future one', () => {
    // The distinction matters to the user: "not a Restorm file" sends them
    // to the right place, "update Restorm" sends them chasing a release.
    for (const garbage of ['2', null, {}, [], Number.NaN, Number.POSITIVE_INFINITY, true]) {
      const result = checkFileFormatCompatibility(documentAtRoot(garbage))
      expect(result.supported).toBe(false)
      expect(result.code).toBe(FILE_FORMAT_MISSING_CODE)
    }
  })

  it('refuses a future version at the document root', () => {
    const result = checkFileFormatCompatibility(documentAtRoot(CURRENT_FILE_FORMAT_VERSION + 1))
    expect(result.supported).toBe(false)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION + 1)
    expect(result.current).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('does not consult a version sitting on a collection', () => {
    // The root is the ONE read site. A document that declares the version
    // where an older build wrote it reads as "absent at the root", which
    // has always meant supported — so it opens, exactly as a file
    // predating the field does.
    const result = checkFileFormatCompatibility({
      collections: [collection(), collection(CURRENT_FILE_FORMAT_VERSION + 5)]
    })
    expect(result.supported).toBe(false)
    expect(result.code).toBe(FILE_FORMAT_MISSING_CODE)
  })

  it('a collection cannot override the version the root declares', () => {
    // Not "the highest wins": the root is the answer, full stop. Nothing
    // written on a collection can pull the verdict either way.
    const result = checkFileFormatCompatibility(
      documentAtRoot(CURRENT_FILE_FORMAT_VERSION, [collection(CURRENT_FILE_FORMAT_VERSION + 3)])
    )
    expect(result.supported).toBe(true)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('refuses on the root value even when a collection claims something lower', () => {
    const result = checkFileFormatCompatibility(
      documentAtRoot(CURRENT_FILE_FORMAT_VERSION + 1, [collection(CURRENT_FILE_FORMAT_VERSION)])
    )
    expect(result.supported).toBe(false)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION + 1)
  })

  it('handles a bare array of collections', () => {
    // An array has no root to read, so nothing is declared.
    expect(checkFileFormatCompatibility([collection(CURRENT_FILE_FORMAT_VERSION + 1)]).supported).toBe(false)
    expect(checkFileFormatCompatibility([collection()]).supported).toBe(false)
  })

  it('handles a single root handed over on its own (an importer output)', () => {
    // Whatever object it is given, the gate reads that object's own
    // top-level key — there is no second place to look.
    expect(checkFileFormatCompatibility(collection(CURRENT_FILE_FORMAT_VERSION + 1)).supported).toBe(false)
    expect(checkFileFormatCompatibility(collection()).supported).toBe(false)
  })

  it('refuses an unrecognisable shape — it declares no version either', () => {
    for (const shape of [null, undefined, 42, 'text', true, { unrelated: 'x' }]) {
      const result = checkFileFormatCompatibility(shape)
      expect(result.supported).toBe(false)
      expect(result.code).toBe(FILE_FORMAT_MISSING_CODE)
    }
  })

  it('never mutates what it reads', () => {
    const content = documentAtRoot(undefined, [collection(), collection(CURRENT_FILE_FORMAT_VERSION)])
    const before = JSON.stringify(content)
    checkFileFormatCompatibility(content)
    expect(JSON.stringify(content)).toBe(before)
  })
})

describe('resolveFileFormatVersion', () => {
  it('reads the document root', () => {
    expect(resolveFileFormatVersion(documentAtRoot(CURRENT_FILE_FORMAT_VERSION), silentLogger))
      .toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('ignores a version sitting on a collection and defaults to current', () => {
    // Same single read site as the gate. Loading such a document as
    // current is correct: that is what an absent version has always
    // meant, and the value it carries on a collection is only ever 1.
    expect(resolveFileFormatVersion({ collections: [collection(1)] }, silentLogger))
      .toBe(CURRENT_FILE_FORMAT_VERSION)
    expect(resolveFileFormatVersion({ collections: [collection(99)] }, silentLogger))
      .toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('defaults to the current version when nothing is declared', () => {
    expect(resolveFileFormatVersion(documentAtRoot(), silentLogger)).toBe(CURRENT_FILE_FORMAT_VERSION)
    expect(resolveFileFormatVersion({}, silentLogger)).toBe(CURRENT_FILE_FORMAT_VERSION)
    expect(resolveFileFormatVersion(null, silentLogger)).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('ignores a malformed value', () => {
    expect(resolveFileFormatVersion(documentAtRoot('one'), silentLogger)).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('warns that the gate was bypassed when a future version reaches it', () => {
    const warn = vi.fn()
    const resolved = resolveFileFormatVersion(documentAtRoot(99), { warn })
    // The value is reported as it stands — this function repairs nothing.
    expect(resolved).toBe(99)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/gate was bypassed/i)
  })

  it('stays quiet on a supported version', () => {
    const warn = vi.fn()
    resolveFileFormatVersion(documentAtRoot(CURRENT_FILE_FORMAT_VERSION), { warn })
    expect(warn).not.toHaveBeenCalled()
  })

  it('never mutates what it reads', () => {
    const content = documentAtRoot(undefined, [collection(1)])
    const before = JSON.stringify(content)
    resolveFileFormatVersion(content, silentLogger)
    expect(JSON.stringify(content)).toBe(before)
  })
})

describe('the persisted document', () => {
  /**
   * The load-then-save pipeline the renderer runs, minus React: resolve
   * the version, strip the position an earlier build used, then hand the
   * document to the serializer. What comes out is what lands on disk.
   */
  function persist(parsedFromDisk: Record<string, unknown>): string {
    const version = resolveFileFormatVersion(parsedFromDisk, silentLogger)
    const collections = (parsedFromDisk['collections'] ?? []) as unknown[]
    return serialize(prepareForSerialization({ fileFormatVersion: version, collections }), 'yaml')
  }

  it('declares the version on its first line, above the collections it applies to', () => {
    const folder = new EnvironmentFolder({ name: 'Petstore' })
    const written = persist({ collections: [folder.toPlainObject()] })

    expect(written.split('\n')[0]).toBe(`${FILE_FORMAT_VERSION_KEY}: ${CURRENT_FILE_FORMAT_VERSION}`)
  })

  it('declares it exactly once, however many collections the document holds', () => {
    const written = persist({
      collections: [
        new EnvironmentFolder({ name: 'One' }).toPlainObject(),
        new EnvironmentFolder({ name: 'Two' }).toPlainObject(),
        new EnvironmentFolder({ name: 'Three' }).toPlainObject()
      ]
    })

    expect(written.match(new RegExp(`${FILE_FORMAT_VERSION_KEY}:`, 'g'))).toHaveLength(1)
  })

  it('carries the version a document declared rather than restamping the current one', () => {
    // This build migrates nothing, so it has no standing to relabel the
    // model a document is written in.
    const written = persist({ fileFormatVersion: 1, collections: [] })
    expect(written.split('\n')[0]).toBe(`${FILE_FORMAT_VERSION_KEY}: 1`)
  })
})
