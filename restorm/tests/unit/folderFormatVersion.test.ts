import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deserialize } from 'electron-core-ui/main'
import { stampFolderFormatVersion } from '../../src/main/utils/folderFormatVersion'
import { CURRENT_FILE_FORMAT_VERSION } from '../../src/shared/config/fileFormatVersion'

/**
 * The filesystem is deliberately real. What is under test is whether a
 * project's root index survives being stamped — a mocked `fs` could only
 * ever prove that the mock was called.
 */

describe('stampFolderFormatVersion', () => {
  let projectPath: string
  const indexPath = (): string => join(projectPath, 'index.yaml')

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'restorm-folder-version-'))
  })

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('creates a root index for a project that has none', async () => {
    const outcome = await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', CURRENT_FILE_FORMAT_VERSION)

    expect(outcome).toBe('created')
    expect(deserialize(readFileSync(indexPath(), 'utf-8'), 'yaml'))
      .toEqual({ fileFormatVersion: CURRENT_FILE_FORMAT_VERSION })
  })

  it('inserts the version beside the identity already in the root index', async () => {
    writeFileSync(indexPath(), '_projectUuid: ca41759c-2fa4-4d87-9d4c-8afaddd587dd\n', 'utf-8')

    const outcome = await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    expect(outcome).toBe('inserted')
    expect(deserialize(readFileSync(indexPath(), 'utf-8'), 'yaml')).toEqual({
      _projectUuid: 'ca41759c-2fa4-4d87-9d4c-8afaddd587dd',
      fileFormatVersion: 1
    })
  })

  it('writes a number, not a string', async () => {
    writeFileSync(indexPath(), '_projectUuid: abc\n', 'utf-8')

    await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    const parsed = deserialize(readFileSync(indexPath(), 'utf-8'), 'yaml') as Record<string, unknown>
    expect(typeof parsed['fileFormatVersion']).toBe('number')
  })

  it('KEEPS THE COMMENTS of a hand-authored root index', async () => {
    // The reason the key goes in as text. A parse/serialise round-trip
    // discards every one of these lines, on a file the user only saved.
    const original = [
      '# Team project index — keep the comment, it explains the layout.',
      '_projectUuid: abc  # stamped on first open',
      '',
      '# Nothing else belongs here.',
      ''
    ].join('\n')
    writeFileSync(indexPath(), original, 'utf-8')

    const outcome = await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    expect(outcome).toBe('inserted')
    const after = readFileSync(indexPath(), 'utf-8')
    expect(after).toContain('# Team project index — keep the comment, it explains the layout.')
    expect(after).toContain('# stamped on first open')
    expect(after).toContain('# Nothing else belongs here.')
    expect(deserialize(after, 'yaml')).toEqual({ _projectUuid: 'abc', fileFormatVersion: 1 })
  })

  it('stamps a json5 folder project as a number, keeping its comments', async () => {
    // A folder project's format comes from `restorm.conf`, so json5 is a
    // real configuration rather than a theoretical one — and the point of
    // the text route is that a hand-authored index survives it.
    const jsonIndex = join(projectPath, 'index.json5')
    const original = [
      '{',
      '  // team project index',
      '  _projectUuid: "ca41759c",',
      '}',
      ''
    ].join('\n')
    writeFileSync(jsonIndex, original, 'utf-8')

    const outcome = await stampFolderFormatVersion(projectPath, 'json5', 'json5', 1)

    expect(outcome).toBe('inserted')
    const after = readFileSync(jsonIndex, 'utf-8')
    expect(after).toContain('// team project index')
    const parsed = deserialize(after, 'json5') as Record<string, unknown>
    expect(parsed['fileFormatVersion']).toBe(1)
    expect(typeof parsed['fileFormatVersion']).toBe('number')
    expect(parsed['_projectUuid']).toBe('ca41759c')
  })

  it('does nothing when the version is already declared', async () => {
    const original = 'fileFormatVersion: 1\n_projectUuid: abc\n'
    writeFileSync(indexPath(), original, 'utf-8')

    const outcome = await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    expect(outcome).toBe('unchanged')
    expect(readFileSync(indexPath(), 'utf-8')).toBe(original)
  })

  it('never overwrites a different version — only a migration may move one', async () => {
    const original = 'fileFormatVersion: 7\n_projectUuid: abc\n'
    writeFileSync(indexPath(), original, 'utf-8')

    const outcome = await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    expect(outcome).toBe('declares-another-version')
    expect(readFileSync(indexPath(), 'utf-8')).toBe(original)
  })

  it('leaves the file alone when the key cannot be added safely', async () => {
    // A sequence root has nowhere to put a top-level key.
    const original = '- first\n- second\n'
    writeFileSync(indexPath(), original, 'utf-8')

    const outcome = await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    expect(outcome).toBe('refused')
    expect(readFileSync(indexPath(), 'utf-8')).toBe(original)
  })

  it('leaves an unparsable root index alone', async () => {
    const original = 'name: [unterminated\n'
    writeFileSync(indexPath(), original, 'utf-8')

    const outcome = await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    expect(outcome).toBe('unreadable')
    expect(readFileSync(indexPath(), 'utf-8')).toBe(original)
  })

  it('touches nothing but the root index', async () => {
    const collectionDir = join(projectPath, '1 - Petstore')
    mkdirSync(collectionDir)
    const collectionIndex = join(collectionDir, 'index.yaml')
    const collectionBefore = 'folderType: environment\nname: Petstore\n'
    writeFileSync(collectionIndex, collectionBefore, 'utf-8')

    await stampFolderFormatVersion(projectPath, 'yaml', 'yaml', 1)

    // The version is a property of the project, so a collection's own
    // index must come out of this untouched — and versionless.
    expect(readFileSync(collectionIndex, 'utf-8')).toBe(collectionBefore)
    expect(existsSync(indexPath())).toBe(true)
  })
})
