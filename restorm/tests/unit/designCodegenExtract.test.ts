/**
 * Controlled extraction + template manifest — the safety half of the
 * codegen pipeline (AC#5's unit slice): traversal refusal writes
 * NOTHING, and an incompatible manifest is refused with a message
 * naming both context versions.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { assertSafeRelativePath, extractGeneratedTree } from '../../src/main/services/designCodegen/extractTree'
import { parseTemplateManifest, templateArchiveUrl } from '../../src/main/services/designCodegen/templateSource'
import { CODEGEN_CONTEXT_VERSION } from '../../src/shared/design/codegenContext'
import { designFingerprint } from '../../src/main/services/designCodegen/DesignCodegenService'
import { buildReferenceApiDesign } from './apiDesignReference'

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

let scratch: string | null = null
afterEach(() => {
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true })
  scratch = null
})

describe('extractGeneratedTree', () => {
  it('writes the tree under the confirmed root', () => {
    scratch = mkdtempSync(join(tmpdir(), 'codegen-extract-'))
    const written = extractGeneratedTree([
      { path: 'src/index.ts', b64: b64('export {}\n') },
      { path: 'package.json', b64: b64('{}\n') }
    ], scratch)
    expect(written.sort()).toEqual(['package.json', join('src', 'index.ts')].sort())
    expect(readFileSync(join(scratch, 'src', 'index.ts'), 'utf8')).toBe('export {}\n')
  })

  it('refuses a traversal and writes NOTHING (no partial tree)', () => {
    scratch = mkdtempSync(join(tmpdir(), 'codegen-extract-'))
    expect(() => extractGeneratedTree([
      { path: 'ok.txt', b64: b64('fine') },
      { path: '../escape.txt', b64: b64('nope') }
    ], scratch)).toThrow(/escapes the output folder/)
    expect(existsSync(join(scratch, 'ok.txt'))).toBe(false)
  })

  it('refuses absolute, drive-lettered and NUL paths', () => {
    expect(() => assertSafeRelativePath('/etc/passwd')).toThrow(/absolute/)
    expect(() => assertSafeRelativePath('C:evil.txt')).toThrow(/absolute/)
    expect(() => assertSafeRelativePath('a/../../b')).toThrow(/escapes/)
    expect(() => assertSafeRelativePath('a\0b')).toThrow(/unsafe/)
    expect(assertSafeRelativePath('a/./b.txt')).toBe(join('a', 'b.txt'))
  })

  it('refuses a path that normalizes onto the root itself', () => {
    // `.` would make the write phase hit the DIRECTORY (EISDIR) after
    // other files already landed — refused at validation instead.
    expect(() => assertSafeRelativePath('.')).toThrow(/unsafe/)
    expect(() => assertSafeRelativePath('./')).toThrow(/unsafe/)
    scratch = mkdtempSync(join(tmpdir(), 'codegen-extract-'))
    expect(() => extractGeneratedTree([
      { path: 'ok.txt', b64: b64('fine') },
      { path: './', b64: b64('boom') }
    ], scratch)).toThrow(/unsafe/)
    expect(existsSync(join(scratch, 'ok.txt'))).toBe(false)
  })

  it('refuses a write THROUGH a pre-existing symlink pointing outside', () => {
    scratch = mkdtempSync(join(tmpdir(), 'codegen-extract-'))
    const outside = mkdtempSync(join(tmpdir(), 'codegen-outside-'))
    try {
      symlinkSync(outside, join(scratch, 'vendor'))
      expect(() => extractGeneratedTree([
        { path: 'vendor/escape.txt', b64: b64('nope') }
      ], scratch)).toThrow(/symlink|interrupted/)
      expect(existsSync(join(outside, 'escape.txt'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('parseTemplateManifest', () => {
  const valid = {
    name: 'Express server',
    type: 'server',
    language: 'TypeScript',
    contextVersions: [CODEGEN_CONTEXT_VERSION]
  }

  it('accepts a compatible manifest', () => {
    expect(parseTemplateManifest(JSON.stringify(valid)).name).toBe('Express server')
  })

  it('refuses an incompatible context version, naming both sides', () => {
    const stale = { ...valid, contextVersions: [999] }
    expect(() => parseTemplateManifest(JSON.stringify(stale)))
      .toThrow(new RegExp(`999.*version ${CODEGEN_CONTEXT_VERSION}`))
  })

  it('refuses a malformed manifest with the schema errors', () => {
    expect(() => parseTemplateManifest('{"name": ""}')).toThrow(/invalid/)
    expect(() => parseTemplateManifest('not json')).toThrow(/not valid JSON/)
  })
})

describe('templateArchiveUrl', () => {
  it('builds the codeload tarball URL from owner/repo or a github URL', () => {
    expect(templateArchiveUrl('Monsieur-Dev/restorm-template-server-rest-typescript'))
      .toBe('https://codeload.github.com/Monsieur-Dev/restorm-template-server-rest-typescript/tar.gz/refs/heads/main')
    expect(templateArchiveUrl('https://github.com/o/r.git', 'dev'))
      .toBe('https://codeload.github.com/o/r/tar.gz/refs/heads/dev')
    expect(() => templateArchiveUrl('not a repo')).toThrow(/not a github repository/)
  })
})

describe('designFingerprint (staleness anchor)', () => {
  const base = buildReferenceApiDesign()

  it('ignores the codegen slot and key ordering', () => {
    const withCodegen = { ...base, codegen: { outputDir: '/tmp/out', templateSource: { kind: 'local' as const, path: '/t' } } }
    // Same generation-relevant content → same fingerprint despite the
    // codegen slot the UI persists between preview and confirm.
    expect(designFingerprint(withCodegen as never)).toBe(designFingerprint(base))
    // Reordered top-level keys hash identically (canonical form).
    const reordered = { routeGroups: base.routeGroups, models: base.models, enums: base.enums, ...base }
    expect(designFingerprint(reordered as never)).toBe(designFingerprint(base))
  })

  it('changes when a generation-relevant field changes', () => {
    const renamed = { ...base, name: `${base.name} v2` }
    expect(designFingerprint(renamed as never)).not.toBe(designFingerprint(base))
    const editedModel = { ...base, models: [{ ...base.models[0], doc: { ...base.models[0].doc, name: 'Renamed' } }, ...base.models.slice(1)] }
    expect(designFingerprint(editedModel as never)).not.toBe(designFingerprint(base))
  })
})
