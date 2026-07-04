/**
 * Guards against a BDD e2e suite silently going unwired: a `tests/e2e/bdd/<suite>/features`
 * directory that has no corresponding project in `playwright.config.ts` is never picked up
 * by `pnpm test:e2e` or CI — it just never runs, with no red anywhere to notice.
 *
 * This happened for real: `tests/e2e/bdd/har-import/` shipped with a full feature+steps
 * dir but no `defineBddConfig`/project entry, so it sat unexercised from the commit that
 * added it until an unrelated audit caught it. This test reads the same two sources a human
 * audit would (the bdd suite directories on disk, and the projects actually wired up in
 * playwright.config.ts) and fails if they ever drift apart again.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const bddRoot = join(__dirname, '../e2e/bdd')
const playwrightConfigPath = join(__dirname, '../../playwright.config.ts')

/**
 * A suite is any immediate child of tests/e2e/bdd that has its own `features` subdirectory.
 * Support dirs like `fixtures/` (shared fixtures) and `_scaffold/` (the new-protocol template)
 * have no `features` subdir, so they're excluded without needing a name-based allowlist.
 */
function findBddSuiteDirs(): string[] {
  return readdirSync(bddRoot)
    .filter((entry) => statSync(join(bddRoot, entry)).isDirectory())
    .filter((entry) => {
      try {
        return statSync(join(bddRoot, entry, 'features')).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * Every wired suite starts life as `const <var> = defineBddConfig({ features:
 * 'tests/e2e/bdd/<suite>/features...' })`. But a defineBddConfig call alone doesn't run
 * anything — it only counts once its `<var>` is actually plugged into a `projects: [...]`
 * entry as `testDir: <var>`. An orphaned const (defined, never referenced) is just as
 * silently-skipped as no config at all, so both are treated as unregistered.
 *
 * Extracted from the raw source rather than importing the config module — the config
 * pulls in playwright-bdd/@playwright/test, which isn't meant to run inside the unit
 * test environment.
 */
function findRegisteredSuiteDirs(): Set<string> {
  const source = readFileSync(playwrightConfigPath, 'utf-8')
  const registered = new Set<string>()
  const configPattern = /const (\w+)\s*=\s*defineBddConfig\(\{\s*features:\s*'tests\/e2e\/bdd\/([^/]+)\/features/g
  let match: RegExpExecArray | null
  while ((match = configPattern.exec(source)) !== null) {
    const [, varName, suite] = match
    if (new RegExp(`testDir:\\s*${varName}\\b`).test(source)) {
      registered.add(suite)
    }
  }
  return registered
}

describe('e2e BDD suite registration', () => {
  const suiteDirs = findBddSuiteDirs()
  const registeredDirs = findRegisteredSuiteDirs()

  it('should find at least one BDD suite directory', () => {
    expect(suiteDirs.length).toBeGreaterThan(0)
  })

  it('should find at least one registered playwright project', () => {
    expect(registeredDirs.size).toBeGreaterThan(0)
  })

  for (const suite of suiteDirs) {
    it(`"${suite}" has a features/ dir wired into playwright.config.ts`, () => {
      expect(registeredDirs.has(suite)).toBe(true)
    })
  }
})
