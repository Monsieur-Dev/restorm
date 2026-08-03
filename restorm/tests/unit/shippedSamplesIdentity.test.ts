import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { setTopLevelKey, deserialize } from 'electron-core-ui/main'
import { PROJECT_UUID_KEY } from '../../src/shared/config/projectUuid'

/**
 * The samples that ship with the app are the first projects a new user
 * opens, and several carry no stored identity — so opening one is the
 * moment the app writes to it. These tests pin that the write is
 * survivable for the files we actually ship, rather than only for the
 * synthetic documents the library's own tests use. No test used to open
 * the files a *user* opens, which is how a destructive write went
 * unnoticed.
 *
 * On the comment assertion, be precise about what it currently proves:
 * today's shipped samples were written BY the app, so they are already
 * in canonical form and contain no true YAML comments — the `#` lines in
 * them are markdown inside embedded documentation strings, which is data
 * and round-trips safely. The assertion therefore passes trivially right
 * now. It earns its place as a guard on what comes next: the moment
 * someone hand-authors a sample, or adds one with real comments or
 * anchors, this is what stops the app quietly eating them.
 *
 * The assertion that bites today is the refusal one — a sample that
 * cannot receive an identity can never have crash-recovery drafts.
 */

function findRestormFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...findRestormFiles(full))
    else if (entry.endsWith('.restorm')) found.push(full)
  }
  return found
}

const SAMPLES_DIR = join(__dirname, '..', '..', 'Samples')
const samples = findRestormFiles(SAMPLES_DIR)

/** Samples with no stored identity — the ones that take the write path. */
const withoutIdentity = samples.filter(
  (f) => !Object.prototype.hasOwnProperty.call(
    (deserialize(readFileSync(f, 'utf-8'), 'yaml') ?? {}) as Record<string, unknown>,
    PROJECT_UUID_KEY
  )
)

describe('shipped samples can be stamped without losing content', () => {
  it('finds the shipped samples', () => {
    expect(samples.length).toBeGreaterThan(0)
  })

  it.each(withoutIdentity.map((f) => [f.slice(SAMPLES_DIR.length + 1), f] as const))(
    'stamps %s without dropping a single comment',
    (_name, file) => {
      const raw = readFileSync(file, 'utf-8')
      const commentsBefore = raw.split('\n').filter((l) => /^\s*#/.test(l)).length

      const stamped = setTopLevelKey(raw, PROJECT_UUID_KEY, 'test-uuid-value', 'yaml')

      // A refusal would mean this sample can never hold an identity, and
      // so can never have crash-recovery drafts. That is a decision to
      // take deliberately, not to discover — so it fails here.
      expect(stamped, 'the shipped sample must accept an identity').not.toBeNull()
      if (stamped === null) throw new Error('unreachable — asserted non-null above')

      const commentsAfter = stamped.split('\n').filter((l) => /^\s*#/.test(l)).length
      expect(commentsAfter).toBe(commentsBefore)

      // The identity is readable back, and the document still parses to
      // exactly what it did before plus that one key.
      const before = deserialize(raw, 'yaml') as Record<string, unknown>
      const after = deserialize(stamped, 'yaml') as Record<string, unknown>
      expect(after[PROJECT_UUID_KEY]).toBe('test-uuid-value')
      expect(Object.keys(after).length).toBe(Object.keys(before).length + 1)
    }
  )

  it('every shipped sample either already has an identity or can receive one', () => {
    const refused = samples.filter((f) => {
      const raw = readFileSync(f, 'utf-8')
      const parsed = (deserialize(raw, 'yaml') ?? {}) as Record<string, unknown>
      if (Object.prototype.hasOwnProperty.call(parsed, PROJECT_UUID_KEY)) return false
      return setTopLevelKey(raw, PROJECT_UUID_KEY, 'probe', 'yaml') === null
    })
    expect(refused, 'these shipped samples could never store an identity').toEqual([])
  })
})
