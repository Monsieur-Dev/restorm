import { describe, it, expect, vi } from 'vitest'
import {
  CURRENT_FILE_FORMAT_VERSION,
  checkFileFormatCompatibility,
  normalizeFileFormatVersion
} from '../../src/shared/config/fileFormatVersion'
import { EnvironmentFolder } from '../../src/shared/models/EnvironmentFolder'

describe('CURRENT_FILE_FORMAT_VERSION', () => {
  it('is 1', () => {
    expect(CURRENT_FILE_FORMAT_VERSION).toBe(1)
  })
})

describe('EnvironmentFolder fileFormatVersion default', () => {
  it('new EnvironmentFolder() has fileFormatVersion = CURRENT_FILE_FORMAT_VERSION', () => {
    const folder = new EnvironmentFolder()
    expect(folder.fileFormatVersion).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('fromPlain() defaults to CURRENT_FILE_FORMAT_VERSION when field is missing', () => {
    const folder = EnvironmentFolder.fromPlain({
      id: 'env-1',
      name: 'Legacy env',
      folderType: 'environment'
    })
    expect(folder.fileFormatVersion).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('fromPlain() preserves a present valid version', () => {
    const folder = EnvironmentFolder.fromPlain({
      id: 'env-1',
      name: 'Env v1',
      folderType: 'environment',
      fileFormatVersion: 1
    })
    expect(folder.fileFormatVersion).toBe(1)
  })

  it('fromPlain() falls back to CURRENT_FILE_FORMAT_VERSION when version is non-numeric garbage', () => {
    const folder = EnvironmentFolder.fromPlain({
      // Cast because `fromPlain` types the input but on-disk data may be
      // malformed — we want the defensive default to kick in.
      id: 'env-1',
      name: 'Garbage',
      folderType: 'environment',
      fileFormatVersion: Number.NaN
    })
    expect(folder.fileFormatVersion).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('toPlainObject() round-trips fileFormatVersion through a JSON cycle', () => {
    const folder = new EnvironmentFolder({ id: 'env-1', name: 'Rt' })
    folder.fileFormatVersion = 1
    const plain = folder.toPlainObject()
    expect(plain['fileFormatVersion']).toBe(1)
    const reloaded = EnvironmentFolder.fromPlain(plain as unknown as Parameters<typeof EnvironmentFolder.fromPlain>[0])
    expect(reloaded.fileFormatVersion).toBe(1)
  })

  it('toPlainObject() places fileFormatVersion right after folderType', () => {
    const folder = new EnvironmentFolder({ id: 'env-1', name: 'Rt' })
    const keys = Object.keys(folder.toPlainObject())
    const folderTypeIdx = keys.indexOf('folderType')
    const versionIdx = keys.indexOf('fileFormatVersion')
    expect(folderTypeIdx).toBeGreaterThanOrEqual(0)
    expect(versionIdx).toBe(folderTypeIdx + 1)
  })
})

describe('normalizeFileFormatVersion', () => {
  const silentLogger = { warn: (): void => { /* noop */ } }

  it('sets the current version when the field is missing', () => {
    const root: Record<string, unknown> = { folderType: 'environment', id: 'x' }
    normalizeFileFormatVersion(root, silentLogger)
    expect(root['fileFormatVersion']).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('leaves a valid current version untouched', () => {
    const root: Record<string, unknown> = { folderType: 'environment', id: 'x', fileFormatVersion: 1 }
    normalizeFileFormatVersion(root, silentLogger)
    expect(root['fileFormatVersion']).toBe(1)
  })

  it('defaults non-numeric versions to the current one', () => {
    const root: Record<string, unknown> = { folderType: 'environment', id: 'x', fileFormatVersion: 'one' }
    normalizeFileFormatVersion(root, silentLogger)
    expect(root['fileFormatVersion']).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('warns about a bypassed gate but preserves a higher-than-current version', () => {
    // This path is unreachable once the compatibility gate runs first;
    // the warning exists to make a new, ungated entry point obvious.
    const warn = vi.fn()
    const root: Record<string, unknown> = { folderType: 'environment', id: 'x', fileFormatVersion: 99 }
    normalizeFileFormatVersion(root, { warn })
    expect(root['fileFormatVersion']).toBe(99)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/gate was bypassed/)
  })

  it('is a no-op on non-env-folder shapes', () => {
    const notAFolder: Record<string, unknown> = { folderType: 'folder' }
    normalizeFileFormatVersion(notAFolder, silentLogger)
    expect('fileFormatVersion' in notAFolder).toBe(false)
  })

  it('is a no-op on null / primitive inputs', () => {
    expect(() => { normalizeFileFormatVersion(null, silentLogger) }).not.toThrow()
    expect(() => { normalizeFileFormatVersion(42, silentLogger) }).not.toThrow()
    expect(() => { normalizeFileFormatVersion('string', silentLogger) }).not.toThrow()
    expect(() => { normalizeFileFormatVersion([], silentLogger) }).not.toThrow()
  })

  it('does not mutate the original reference when the field is already current', () => {
    // Defaulting on legacy files must not look like a user edit — the
    // caller (file-open path) relies on this to avoid firing spurious
    // dirty signals on documents loaded from fully-up-to-date files.
    const root: Record<string, unknown> = { folderType: 'environment', id: 'x', fileFormatVersion: 1, other: 'unchanged' }
    const snapshot = JSON.parse(JSON.stringify(root))
    normalizeFileFormatVersion(root, silentLogger)
    expect(root).toEqual(snapshot)
  })
})

describe('checkFileFormatCompatibility', () => {
  const envRoot = (fileFormatVersion?: unknown): Record<string, unknown> => {
    const root: Record<string, unknown> = { folderType: 'environment', id: 'env-1', name: 'Root' }
    if (fileFormatVersion !== undefined) root['fileFormatVersion'] = fileFormatVersion
    return root
  }

  it('accepts a document at the current version', () => {
    const result = checkFileFormatCompatibility({ collections: [envRoot(CURRENT_FILE_FORMAT_VERSION)] })
    expect(result.supported).toBe(true)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION)
    expect(result.current).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('accepts a document below the current version', () => {
    const result = checkFileFormatCompatibility({ collections: [envRoot(CURRENT_FILE_FORMAT_VERSION - 1)] })
    expect(result.supported).toBe(true)
  })

  it('accepts a legacy document with no version field', () => {
    const result = checkFileFormatCompatibility({ collections: [envRoot()] })
    expect(result.supported).toBe(true)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION)
  })

  it('accepts a document whose version is not a finite number', () => {
    // Malformed values default to current, exactly as the normalizer does —
    // garbage in the field is a repairable defect, not a future format.
    for (const garbage of ['two', null, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      expect(checkFileFormatCompatibility({ collections: [envRoot(garbage)] }).supported).toBe(true)
    }
  })

  it('refuses a document above the current version', () => {
    const result = checkFileFormatCompatibility({ collections: [envRoot(CURRENT_FILE_FORMAT_VERSION + 1)] })
    expect(result.supported).toBe(false)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION + 1)
  })

  it('refuses when ANY root is from the future, not just the first', () => {
    // A document assembled from several collections is only as openable
    // as its newest root — accepting it would load part of the file.
    const result = checkFileFormatCompatibility({
      collections: [envRoot(CURRENT_FILE_FORMAT_VERSION), envRoot(CURRENT_FILE_FORMAT_VERSION + 5)]
    })
    expect(result.supported).toBe(false)
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION + 5)
  })

  it('reports the HIGHEST future version found', () => {
    const result = checkFileFormatCompatibility({
      collections: [envRoot(CURRENT_FILE_FORMAT_VERSION + 9), envRoot(CURRENT_FILE_FORMAT_VERSION + 2)]
    })
    expect(result.found).toBe(CURRENT_FILE_FORMAT_VERSION + 9)
  })

  it('checks a bare array of roots', () => {
    expect(checkFileFormatCompatibility([envRoot(CURRENT_FILE_FORMAT_VERSION + 1)]).supported).toBe(false)
    expect(checkFileFormatCompatibility([envRoot()]).supported).toBe(true)
  })

  it('checks a single root handed over on its own', () => {
    expect(checkFileFormatCompatibility(envRoot(CURRENT_FILE_FORMAT_VERSION + 1)).supported).toBe(false)
    expect(checkFileFormatCompatibility(envRoot()).supported).toBe(true)
  })

  it('treats unrecognisable content as supported', () => {
    // An unparsable or empty file is a different failure with a different
    // message; claiming "update your Restorm" here would misdirect the user.
    for (const shape of [null, undefined, 42, 'text', {}, { collections: 'not-an-array' }]) {
      expect(checkFileFormatCompatibility(shape).supported).toBe(true)
    }
  })

  it('never mutates the content it inspects', () => {
    const content = { collections: [envRoot(), envRoot(CURRENT_FILE_FORMAT_VERSION)] }
    const snapshot = JSON.parse(JSON.stringify(content))
    checkFileFormatCompatibility(content)
    expect(content).toEqual(snapshot)
  })
})
