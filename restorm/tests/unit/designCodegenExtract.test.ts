/**
 * Controlled extraction + template manifest — the safety half of the
 * codegen pipeline (AC#5's unit slice): traversal refusal writes
 * NOTHING, and an incompatible manifest is refused with a message
 * naming both context versions.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { assertSafeRelativePath, extractGeneratedTree } from '../../src/main/services/designCodegen/extractTree'
import { parseTemplateManifest, templateArchiveUrl, rawManifestUrl, readManifestVariables, scanUsedVariables, readCopierQuestions, readAnswersFile } from '../../src/main/services/designCodegen/templateSource'
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

  it('accepts a template built for an OLDER context version (additive superset)', () => {
    // A template declaring only v1 still runs against a v2+ Restorm — the newer
    // context only ADDS optional fields, so the older shape is fully satisfied.
    const older = { ...valid, contextVersions: [1] }
    expect(parseTemplateManifest(JSON.stringify(older)).name).toBe('Express server')
  })

  it('refuses a malformed manifest with the schema errors', () => {
    expect(() => parseTemplateManifest('{"name": ""}')).toThrow(/invalid/)
    expect(() => parseTemplateManifest('not json')).toThrow(/not valid JSON/)
  })

  it('accepts declared user variables (name/scope/type + optional default, options)', () => {
    const withVars = {
      ...valid,
      variables: [
        { name: 'cache_type', scope: 'project', type: 'enum', options: ['none', 'memory', 'redis'], default: 'none' },
        { name: 'useCache', scope: 'route', type: 'boolean', default: 'false', description: 'Cache this route.' }
      ]
    }
    const parsed = parseTemplateManifest(JSON.stringify(withVars))
    expect(parsed.variables?.map((v) => v.name)).toEqual(['cache_type', 'useCache'])
    expect(parsed.variables?.[0]?.scope).toBe('project')
  })

  it('refuses a variable with an unknown scope or type', () => {
    const badScope = { ...valid, variables: [{ name: 'x', scope: 'enum', type: 'string' }] }
    expect(() => parseTemplateManifest(JSON.stringify(badScope))).toThrow(/invalid/)
    const badType = { ...valid, variables: [{ name: 'x', scope: 'route', type: 'json' }] }
    expect(() => parseTemplateManifest(JSON.stringify(badType))).toThrow(/invalid/)
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

describe('rawManifestUrl', () => {
  it('builds the raw manifest URL from owner/repo or a github URL', () => {
    expect(rawManifestUrl('owner/repo'))
      .toBe('https://raw.githubusercontent.com/owner/repo/main/restorm-template.json')
    expect(rawManifestUrl('https://github.com/o/r.git', 'v2'))
      .toBe('https://raw.githubusercontent.com/o/r/v2/restorm-template.json')
    expect(() => rawManifestUrl('nope')).toThrow(/not a github repository/)
  })
})

describe('readManifestVariables', () => {
  const base = { name: 'X', type: 'server', language: 'ts', contextVersions: [1] }

  it('extracts the declared variables', () => {
    const text = JSON.stringify({ ...base, variables: [{ name: 'cache', scope: 'route', type: 'boolean' }] })
    expect(readManifestVariables(text)).toEqual([{ name: 'cache', scope: 'route', type: 'boolean' }])
  })

  it('returns [] when the manifest declares none', () => {
    expect(readManifestVariables(JSON.stringify(base))).toEqual([])
  })

  it('is lenient on the context version (pre-fill still shows the keys)', () => {
    const text = JSON.stringify({ ...base, contextVersions: [999], variables: [{ name: 'x', scope: 'project', type: 'string' }] })
    expect(readManifestVariables(text).map((v) => v.name)).toEqual(['x'])
  })

  it('throws on invalid JSON or a malformed manifest', () => {
    expect(() => readManifestVariables('not json')).toThrow(/not valid JSON/)
    expect(() => readManifestVariables('{"name":""}')).toThrow(/invalid/)
  })
})

describe('scanUsedVariables (discovery)', () => {
  it('finds dot- and bracket-access .vars usages, whatever the object', () => {
    const tpl = [
      '{{ ctx.design.vars.cache_type }}',
      "{% for m in ctx.models %}{{ m.vars.table_prefix }}{% endfor %}",
      "{{ route.vars['use_cache'] }}",
      '{{ ctx.design.vars["region"] }}'
    ].join('\n')
    expect(scanUsedVariables(tpl)).toEqual(['cache_type', 'region', 'table_prefix', 'use_cache'])
  })

  it('dedupes and returns [] when nothing references .vars', () => {
    expect(scanUsedVariables('{{ ctx.design.name }} {{ x.vars.a }} {{ y.vars.a }}')).toEqual(['a'])
    expect(scanUsedVariables('no variables here {{ ctx.models }}')).toEqual([])
  })
})

describe('readCopierQuestions (Copier questions)', () => {
  it('reads typed questions with defaults + help, skipping `_`-prefixed meta', () => {
    const yml = [
      'project_slug:',
      '  type: str',
      '  default: restorm-api',
      '  help: The project folder name',
      'retries:',
      '  type: int',
      '  default: 3',
      '_subdirectory: template',
      '_templates_suffix: .jinja'
    ].join('\n')
    expect(readCopierQuestions(yml)).toEqual([
      { key: 'project_slug', type: 'str', default: 'restorm-api', help: 'The project folder name' },
      { key: 'retries', type: 'int', default: 3 }
    ])
  })

  it('surfaces choices and a bare `key: value` shorthand (type inferred)', () => {
    const yml = [
      'db:',
      '  type: str',
      '  choices: [postgres, mysql]',
      'debug: false'
    ].join('\n')
    expect(readCopierQuestions(yml)).toEqual([
      { key: 'db', type: 'str', choices: ['postgres', 'mysql'] },
      { key: 'debug', type: 'bool', default: false }
    ])
  })

  it('captures multiselect + choices', () => {
    const yml = ['features:', '  type: str', '  multiselect: true', '  choices: [auth, cache, search]'].join('\n')
    expect(readCopierQuestions(yml)).toEqual([
      { key: 'features', type: 'str', choices: ['auth', 'cache', 'search'], multiselect: true }
    ])
  })

  it('is lenient: returns [] for empty / non-mapping input', () => {
    expect(readCopierQuestions('')).toEqual([])
    expect(readCopierQuestions('- a\n- b')).toEqual([])
  })
})

describe('readAnswersFile (Copier round-trip)', () => {
  it('reads saved answers, stripping `_`-prefixed meta; absent → {}', () => {
    scratch = mkdtempSync(join(tmpdir(), 'codegen-answers-'))
    expect(readAnswersFile(scratch)).toEqual({})
    writeFileSync(join(scratch, '.copier-answers.yml'), 'project_slug: my-api\n_src_path: gh:x\n')
    expect(readAnswersFile(scratch)).toEqual({ project_slug: 'my-api' })
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
