/**
 * Locale resolution for the post-update "What's new" note.
 *
 * `getChangelogSince(fromVersion, locale)` must read the hand-maintained
 * `changelogs/<locale>.md` when one exists and only fall back to the English
 * `CHANGELOG.md` otherwise. The locale travels renderer → preload → IPC →
 * service, so a silent drop anywhere on that path shows up here as English
 * prose where a translation was expected.
 *
 * The candidate files are read from disk relative to `app.getAppPath()`, so the
 * fixtures are a real temp tree rather than a mocked `fs` — that keeps the test
 * honest about the path arithmetic instead of only about the branch logic.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { UpdateService } from './UpdateService'

// Mutable holder so the hoisted `electron` mock can hand out a path that only
// exists once `beforeAll` has built the fixture tree.
const appRoot = vi.hoisted(() => ({ path: '' }))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.19',
    isPackaged: true,
    getAppPath: () => appRoot.path
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('electron-updater', () => ({ autoUpdater: {} }))

vi.mock('electron-core-ui/main', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withFirewallBypass: <T,>(fn: () => Promise<T>) => fn(),
  getSettingsService: () => ({
    get: () => undefined,
    set: () => undefined,
    onSettingChanged: () => () => undefined
  }),
  getStorageService: () => ({ get: () => undefined, set: () => undefined })
}))

/** A changelog whose only distinguishing content is `marker`. */
function changelog(marker: string): string {
  return ['# Changelog', '', '## v0.1.19', '', `- ${marker}`, ''].join('\n')
}

const ENGLISH = 'english-release-note'
const FRENCH = 'french-release-note'
const PORTUGUESE = 'portuguese-release-note'
const DECOY = 'decoy-release-note'

// `resourcesPath` is injected by Electron and typed read-only; outside Electron
// it is absent, so a plain node test run has to stand it up itself.
const processResources = process as unknown as { resourcesPath?: string }
let previousResourcesPath: string | undefined

beforeAll(() => {
  appRoot.path = mkdtempSync(join(tmpdir(), 'restorm-changelog-locale-'))
  mkdirSync(join(appRoot.path, 'changelogs'))
  writeFileSync(join(appRoot.path, 'CHANGELOG.md'), changelog(ENGLISH), 'utf8')
  writeFileSync(join(appRoot.path, 'changelogs', 'fr.md'), changelog(FRENCH), 'utf8')
  writeFileSync(join(appRoot.path, 'changelogs', 'pt.md'), changelog(PORTUGUESE), 'utf8')
  // English deliberately has no per-locale file in production; a decoy proves
  // the resolver skips `changelogs/en.md` rather than preferring it.
  writeFileSync(join(appRoot.path, 'changelogs', 'en.md'), changelog(DECOY), 'utf8')

  // The resolver's first candidate is under `process.resourcesPath`. Point it at
  // a path that cannot exist so the packaged branch is exercised as a miss
  // instead of throwing on `join(undefined, …)`.
  previousResourcesPath = processResources.resourcesPath
  processResources.resourcesPath = join(appRoot.path, 'no-such-resources')
})

afterAll(() => {
  if (previousResourcesPath === undefined) {
    delete processResources.resourcesPath
  } else {
    processResources.resourcesPath = previousResourcesPath
  }
  rmSync(appRoot.path, { recursive: true, force: true })
})

/** Notes for the span ending at the current version (0.1.19). */
function notesFor(locale?: string): string {
  return new UpdateService({ now: () => 1_700_000_000_000 }).getChangelogSince('0.1.17', locale)
}

describe('getChangelogSince locale resolution', () => {
  it('reads changelogs/<locale>.md when the locale has translated notes', () => {
    const notes = notesFor('fr')
    expect(notes).toContain(FRENCH)
    expect(notes).not.toContain(ENGLISH)
  })

  it('falls back to the base language for a regional locale', () => {
    const notes = notesFor('pt-BR')
    expect(notes).toContain(PORTUGUESE)
    expect(notes).not.toContain(ENGLISH)
  })

  it('falls back to English for a locale with no translated notes', () => {
    const notes = notesFor('zz')
    expect(notes).toContain(ENGLISH)
    expect(notes).not.toContain(FRENCH)
    expect(notes).not.toContain(PORTUGUESE)
  })

  it('falls back to English when no locale is passed at all', () => {
    const notes = notesFor()
    expect(notes).toContain(ENGLISH)
    expect(notes).not.toContain(FRENCH)
  })

  it('reads the canonical CHANGELOG.md for English, not changelogs/en.md', () => {
    const notes = notesFor('en')
    expect(notes).toContain(ENGLISH)
    expect(notes).not.toContain(DECOY)
  })

  it('tolerates surrounding whitespace on the locale tag', () => {
    expect(notesFor('  fr  ')).toContain(FRENCH)
  })
})
