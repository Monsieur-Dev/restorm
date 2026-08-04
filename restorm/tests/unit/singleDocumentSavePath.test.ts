import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * There is ONE place that writes a whole `.restorm` document, and ONE
 * listener for the save-and-close event.
 *
 * Both invariants were broken at once, in a way nothing detected: a second
 * `onSaveAndClose` registration in `App.tsx` built its own payload, and
 * because `onSaveAndClose` registers through `ipcRenderer.on`, BOTH
 * listeners fired and two whole-document saves raced. The file kept
 * whichever landed last. The two payloads were not equivalent — one
 * carried the document's format version and wrote the `.env` sidecar, the
 * other did neither — so the loser silently dropped both.
 *
 * Nothing failed when it did: a document with no root version reads as
 * *supported / current* by design, and the sidecar only matters to
 * passwords. A type cannot express "there is only one of these", so this
 * test does: it fails loudly the moment a second document writer or a
 * second close-listener appears, which is the only warning a reviewer
 * would otherwise get.
 */

const RENDERER = join(__dirname, '..', '..', 'src', 'renderer')
const RESTORM_ROOT = join(__dirname, '..', '..')

/** The single module allowed to write a whole document. */
const OWNER = join('src', 'renderer', 'src', 'hooks', 'useFileManagement.ts')

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full)
  }
  return found
}

const files = sourceFiles(RENDERER).map((f) => ({
  name: relative(RESTORM_ROOT, f),
  text: readFileSync(f, 'utf-8')
}))

/** Calls that write the whole document to disk. */
const WHOLE_DOCUMENT_WRITES = /\bsaveFile\(|\bfile\.saveAsFile\(|\bfile\.saveAsFolder\(/g

describe('one save path, one close listener', () => {
  it('scans the renderer sources', () => {
    expect(files.length).toBeGreaterThan(0)
    expect(files.some((f) => f.name === OWNER)).toBe(true)
  })

  it('only one module writes a whole document', () => {
    const offenders = files
      .filter((f) => f.name !== OWNER && WHOLE_DOCUMENT_WRITES.test(f.text))
      .map((f) => f.name)
    expect(
      offenders,
      `a whole-document write outside ${OWNER}: route it through the hook, whose buildDocument carries the document format version and whose handler writes the .env sidecar — a second writer means whichever lands last decides, and the loser drops both silently`
    ).toEqual([])
  })

  it('registers exactly one save-and-close listener', () => {
    // `onSaveAndClose` uses `ipcRenderer.on`, so a second registration does
    // not replace the first — both fire, and both write.
    const registrations = files.flatMap((f) =>
      (f.text.match(/onSaveAndClose\(/g) ?? []).map(() => f.name)
    )
    expect(registrations, 'two listeners means two concurrent saves racing on one event').toHaveLength(1)
  })
})
