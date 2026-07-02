// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SpawnSyncReturns } from 'node:child_process'

const FIXTURES = path.join(__dirname, 'fixtures/typespec')
const FIXTURE_TSP = path.join(FIXTURES, 'petstore.tsp')
const FIXTURE_CONTENT = fs.readFileSync(FIXTURE_TSP, 'utf-8')
const FIXTURE_OPENAPI = fs.readFileSync(path.join(FIXTURES, 'petstore.openapi.yaml'), 'utf-8')

const spawnSyncMock = vi.fn<(...args: unknown[]) => SpawnSyncReturns<string>>()
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawnSync: (...args: unknown[]): SpawnSyncReturns<string> => spawnSyncMock(...args)
  }
})

import { importTypeSpec, findAncestorNodeModulesWithTypeSpecCompiler } from '../../src/main/services/import/TypeSpecImportService'
import { importProviders } from '../../src/main/services/import/registry'
import type { Folder, HTTPRequest } from '../../src/shared/models'

function buildSpawnResult(overrides: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> {
  return {
    pid: 1234,
    output: [null, '', ''],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    ...overrides
  }
}

/** Extract the `--output-dir` value the service passed to `tsp compile`. */
function outputDirFromArgs(args: unknown): string {
  const argv = args as string[]
  const idx = argv.indexOf('--output-dir')
  const dir = argv[idx + 1]
  if (dir === undefined) throw new Error('--output-dir not found in spawnSync args')
  return dir
}

/** Extract the compile target (the `.tsp` entry file path) the service
 * passed to `tsp compile` — the args array is
 * `[<tspCliEntry.js>, 'compile', <entryFile>, ...]` since `spawnSync` is
 * invoked as `process.execPath <tspCliEntry.js> compile <entryFile> ...`. */
function entryFileFromArgs(args: unknown): string {
  const argv = args as string[]
  const idx = argv.indexOf('compile')
  if (idx === -1) throw new Error('expected "compile" in spawnSync args')
  const entry = argv[idx + 1]
  if (entry === undefined) throw new Error('no compile target found in spawnSync args')
  return entry
}

/** Simulate a successful `tsp compile @typespec/openapi3` run by writing the
 * fixture's pre-compiled output where the emitter would have written it. */
function mockSuccessfulCompile(): void {
  spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
    const outputDir = outputDirFromArgs(args)
    const emitterDir = path.join(outputDir, '@typespec', 'openapi3')
    fs.mkdirSync(emitterDir, { recursive: true })
    fs.writeFileSync(path.join(emitterDir, 'openapi.yaml'), FIXTURE_OPENAPI)
    return buildSpawnResult()
  })
}

beforeEach(() => {
  spawnSyncMock.mockReset()
})

describe('TypeSpecImportService — canImport', () => {
  const provider = importProviders.find((p) => p.format === 'typespec')

  it('is registered', () => {
    expect(provider).toBeDefined()
  })

  it('returns true for a .tsp file path regardless of content', () => {
    expect(provider?.canImport('anything at all', '/some/project/main.tsp')).toBe(true)
    expect(provider?.canImport('', '/some/project/Main.TSP')).toBe(true)
  })

  it('returns false without a .tsp file path', () => {
    expect(provider?.canImport('openapi: 3.0.0', '/some/project/spec.yaml')).toBe(false)
    expect(provider?.canImport('openapi: 3.0.0')).toBe(false)
  })
})

describe('TypeSpecImportService — fail-closed when the trusted node_modules is missing', () => {
  it('throws — never falls back to source-dir resolution — when no ancestor has @typespec/compiler', () => {
    // A synthetic directory whose entire ancestry (up to filesystem root) has
    // no `node_modules/@typespec/compiler` — the invariant this asserts is
    // "fail closed", i.e. TypeSpec import must refuse to run rather than
    // silently falling back to resolving against some other (untrusted)
    // directory, which would reopen the exact RCE isolation exists to close.
    const isolatedEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restorm-typespec-no-compiler-'))
    try {
      expect(() => findAncestorNodeModulesWithTypeSpecCompiler(isolatedEmptyDir)).toThrow(
        /Could not locate a local @typespec\/compiler install/
      )
    } finally {
      fs.rmSync(isolatedEmptyDir, { recursive: true, force: true })
    }
  })
})

describe('TypeSpecImportService — happy path (mocked tsp CLI)', () => {
  it('compiles the .tsp content and imports the emitted OpenAPI document', () => {
    mockSuccessfulCompile()

    const folder = importTypeSpec(FIXTURE_CONTENT)

    expect(folder.folderType).toBe('environment')
    expect(folder.name).toBe('Pet Store')
    expect(folder.importSource).toBe('typespec')

    const allRequests: HTTPRequest[] = []
    const walk = (items: Folder['items']): void => {
      for (const item of items) {
        if ('items' in item) walk((item as Folder).items)
        else allRequests.push(item as HTTPRequest)
      }
    }
    walk(folder.items)
    expect(allRequests.some((r) => r.url.endsWith('/pets'))).toBe(true)
    expect(allRequests.some((r) => r.url.includes('/pets/{{id}}'))).toBe(true)
  })

  it('compiles an ISOLATED copy of the content, never the caller\'s own file path', () => {
    // Read the isolated entry file's content INSIDE the mock — the service's
    // own `finally` block deletes the isolated dir as soon as `importTypeSpec`
    // returns, so asserting on disk state has to happen mid-call.
    let capturedEntryContent: string | undefined
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const entryFile = entryFileFromArgs(args)
      capturedEntryContent = fs.readFileSync(entryFile, 'utf-8')
      const outputDir = outputDirFromArgs(args)
      const emitterDir = path.join(outputDir, '@typespec', 'openapi3')
      fs.mkdirSync(emitterDir, { recursive: true })
      fs.writeFileSync(path.join(emitterDir, 'openapi.yaml'), FIXTURE_OPENAPI)
      return buildSpawnResult()
    })

    importTypeSpec(FIXTURE_CONTENT)

    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
    const [cmd, args, spawnOptions] = spawnSyncMock.mock.calls[0] as [string, string[], { env?: Record<string, string> }]
    // Electron's own binary (process.execPath) running as plain Node via
    // ELECTRON_RUN_AS_NODE, invoking the compiler's JS entry directly —
    // never a bare 'tsp' resolved off PATH, never even pnpm's `.bin/tsp`
    // shell shim (which itself needs a system `node`). This is what makes a
    // packaged app work with no TypeSpec tooling — and no system Node —
    // installed anywhere on the user's machine.
    expect(cmd).toBe(process.execPath)
    expect(spawnOptions.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    const tspCliEntry = args[0]
    expect(tspCliEntry).toBeDefined()
    expect(path.basename(tspCliEntry ?? '')).toMatch(/^tsp(\.js)?$/)
    expect(tspCliEntry).toContain(path.join('@typespec', 'compiler'))
    expect(args).toEqual(expect.arrayContaining(['compile', '--emit', '@typespec/openapi3']))
    const entryFile = entryFileFromArgs(args)
    // Never the fixture's own path — always a fresh, isolated temp copy.
    expect(entryFile).not.toBe(FIXTURE_TSP)
    expect(path.basename(entryFile)).toBe('main.tsp')
    expect(capturedEntryContent).toBe(FIXTURE_CONTENT)
  })

  it('symlinks its own node_modules into the isolated source dir (so imports resolve to trusted libs)', () => {
    let sourceDirNodeModules: string | undefined
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      const entryFile = entryFileFromArgs(args)
      sourceDirNodeModules = path.join(path.dirname(entryFile), 'node_modules')
      // Captured while the isolated dir still exists (before the service's
      // own cleanup runs) — assert existence here, not after the call.
      expect(fs.existsSync(sourceDirNodeModules)).toBe(true)
      expect(fs.lstatSync(sourceDirNodeModules).isSymbolicLink()).toBe(true)
      const outputDir = outputDirFromArgs(args)
      const emitterDir = path.join(outputDir, '@typespec', 'openapi3')
      fs.mkdirSync(emitterDir, { recursive: true })
      fs.writeFileSync(path.join(emitterDir, 'openapi.yaml'), FIXTURE_OPENAPI)
      return buildSpawnResult()
    })

    importTypeSpec(FIXTURE_CONTENT)

    expect(sourceDirNodeModules).toBeDefined()
  })

  it('cleans up both its isolated source dir and its temp output dir', () => {
    let capturedSourceDir = ''
    let capturedOutputDir = ''
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      capturedSourceDir = path.dirname(entryFileFromArgs(args))
      capturedOutputDir = outputDirFromArgs(args)
      const emitterDir = path.join(capturedOutputDir, '@typespec', 'openapi3')
      fs.mkdirSync(emitterDir, { recursive: true })
      fs.writeFileSync(path.join(emitterDir, 'openapi.yaml'), FIXTURE_OPENAPI)
      return buildSpawnResult()
    })

    importTypeSpec(FIXTURE_CONTENT)

    expect(capturedSourceDir).not.toBe('')
    expect(capturedOutputDir).not.toBe('')
    expect(fs.existsSync(capturedSourceDir)).toBe(false)
    expect(fs.existsSync(capturedOutputDir)).toBe(false)
  })

  it('is idempotent: re-running against the same content yields structurally identical results', () => {
    mockSuccessfulCompile()
    const first = importTypeSpec(FIXTURE_CONTENT)
    mockSuccessfulCompile()
    const second = importTypeSpec(FIXTURE_CONTENT)
    expect(second).toEqual(first)
  })
})

describe('TypeSpecImportService — bundled tsp binary missing', () => {
  it('throws a clear "broken install" message instead of a raw ENOENT stack trace', () => {
    // Restorm resolves its OWN bundled binary (no PATH lookup), so an
    // ENOENT here means the local install itself is broken/incomplete —
    // not a missing global install, which is why the message points at
    // reinstalling Restorm rather than `npm install -g`.
    spawnSyncMock.mockImplementation(() => buildSpawnResult({
      status: null,
      error: Object.assign(new Error('spawnSync tsp ENOENT'), { code: 'ENOENT' })
    }))

    expect(() => importTypeSpec(FIXTURE_CONTENT)).toThrow(
      /TypeSpec compiler is missing from this Restorm installation/
    )
  })
})

describe('TypeSpecImportService — tsp compile failure', () => {
  it('surfaces the compiler diagnostics in the thrown error', () => {
    spawnSyncMock.mockImplementation(() => buildSpawnResult({
      status: 1,
      stderr: 'main.tsp:3:1 - error unknown-identifier: Unknown identifier NotAType'
    }))

    expect(() => importTypeSpec(FIXTURE_CONTENT)).toThrow(/unknown-identifier/)
  })

  it('reports a timeout distinctly from an ordinary compile failure', () => {
    spawnSyncMock.mockImplementation(() => buildSpawnResult({
      status: null,
      signal: 'SIGTERM'
    }))

    expect(() => importTypeSpec(FIXTURE_CONTENT)).toThrow(/timed out/)
  })
})

describe('TypeSpecImportService — provider parse contract', () => {
  const provider = importProviders.find((p) => p.format === 'typespec')

  it('requires opts.filePath (file-based only — no paste / URL support)', () => {
    expect(() => provider?.parse('paste-only content, no real file', {})).toThrow(
      /only supports local \.tsp files/
    )
  })

  it('delegates to importTypeSpec (compiling the extracted content, isolated) when opts.filePath is set', () => {
    mockSuccessfulCompile()
    const folder = provider?.parse(FIXTURE_CONTENT, { filePath: FIXTURE_TSP })
    expect(folder?.name).toBe('Pet Store')
  })
})
