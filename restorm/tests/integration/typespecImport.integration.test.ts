/**
 * Integration test for TypeSpec import — exercises Restorm's OWN bundled
 * `tsp` compiler (`@typespec/compiler` + `@typespec/http` +
 * `@typespec/openapi3`, real `dependencies` of this package — bundled into
 * every build, dev and packaged) end to end, with no mocked `spawnSync`.
 * Invoked as `process.execPath <tspCliEntry.js> compile ...` with
 * `ELECTRON_RUN_AS_NODE=1` (see `TypeSpecImportService.ts`'s
 * `resolveTspCliEntry` / `importTypeSpec`) — no `tsp` binary looked up via
 * `PATH`, and no system `node` needed either (unit tests mock the CLI
 * instead — see `tests/unit/TypeSpecImportService.test.ts` — so this is the
 * one place the real compiler output shape, AND the real
 * isolated-compilation trust boundary, are verified against the real
 * compiler rather than a mock.
 */
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { importTypeSpec } from '../../src/main/services/import/TypeSpecImportService'
import type { Folder, HTTPRequest } from '../../src/shared/models'

const FIXTURE_TSP = join(__dirname, '../unit/fixtures/typespec/petstore.tsp')
const FIXTURE_CONTENT = readFileSync(FIXTURE_TSP, 'utf-8')

function collectRequests(folder: { items: Folder['items'] }): HTTPRequest[] {
  const allRequests: HTTPRequest[] = []
  const walk = (items: Folder['items']): void => {
    for (const item of items) {
      if ('items' in item) walk((item as Folder).items)
      else allRequests.push(item as HTTPRequest)
    }
  }
  walk(folder.items)
  return allRequests
}

describe('TypeSpec import — real tsp compiler', () => {
  it('compiles the petstore sample and imports it via the real @typespec/compiler + @typespec/openapi3', () => {
    const folder = importTypeSpec(FIXTURE_CONTENT)

    expect(folder.name).toBe('Pet Store')
    expect(folder.importSource).toBe('typespec')
    expect(collectRequests(folder).map((r) => r.name).sort()).toEqual(['Pets_create', 'Pets_list', 'Pets_read'])
  })

  it('is idempotent: compiling the same content twice yields structurally identical results', () => {
    const first = importTypeSpec(FIXTURE_CONTENT)
    const second = importTypeSpec(FIXTURE_CONTENT)
    expect(second).toEqual(first)
  })

  it('does not depend on PATH at all — resolves + runs its own bundled compiler via process.execPath', () => {
    // Restorm invokes its OWN bundled compiler's JS entry via
    // `process.execPath` (Electron's own binary, `ELECTRON_RUN_AS_NODE=1`)
    // — never a `tsp` binary resolved off PATH, and never even pnpm's
    // `.bin/tsp` shell shim (which itself execs a system `node`). Strip
    // PATH down to nothing at all — the real compile must still succeed,
    // proving a packaged app needs neither a global TypeSpec install nor a
    // system Node on the user's machine.
    const originalPath = process.env.PATH
    try {
      process.env.PATH = ''
      const folder = importTypeSpec(FIXTURE_CONTENT)
      expect(folder.name).toBe('Pet Store')
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('ignores a tspconfig.yaml sitting next to the source file — isolated compilation, real compiler', () => {
    // Reproduce the exact attacker shape the isolation defends against: a
    // `.tsp` file living alongside a `tspconfig.yaml` that would break
    // compilation if the compiler ever consulted it (it declares an emitter
    // that doesn't exist). Restorm never compiles the file in this
    // directory — it only reads the CONTENT and compiles an isolated copy
    // — so this must succeed exactly like the plain fixture does.
    const maliciousDir = mkdtempSync(join(tmpdir(), 'restorm-typespec-trust-test-'))
    try {
      writeFileSync(join(maliciousDir, 'main.tsp'), FIXTURE_CONTENT, 'utf-8')
      writeFileSync(
        join(maliciousDir, 'tspconfig.yaml'),
        'emit:\n  - "not-a-real-emitter-package"\n',
        'utf-8'
      )
      const contentFromMaliciousDir = readFileSync(join(maliciousDir, 'main.tsp'), 'utf-8')

      const folder = importTypeSpec(contentFromMaliciousDir)

      expect(folder.name).toBe('Pet Store')
      expect(collectRequests(folder).map((r) => r.name).sort()).toEqual(['Pets_create', 'Pets_list', 'Pets_read'])
    } finally {
      rmSync(maliciousDir, { recursive: true, force: true })
    }
  })
})
