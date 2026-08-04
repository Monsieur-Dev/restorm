import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  canonicalizeSerializedKeys,
  CANONICAL_KEY_PRIORITY,
  prepareForSerialization,
  processAfterDeserialization
} from './serialization'
import { diffProjectEntities, parseProjectYaml } from '../../../shared/git/gitCommitDiff'

/**
 * The persisted project shape must be an INVARIANT: the same logical
 * document always serializes to the same bytes, independent of the in-memory
 * property insertion order. That order otherwise varies by construction path
 * (a file parsed by build A vs the class/default order build B rebuilds it
 * in), which is exactly what makes the first save after a build upgrade
 * reformat the whole file. These tests pin the canonical key order, prove
 * open→save is a byte-stable fixed point, and prove two builds that hold the
 * same data in different key orders serialize identically — no electron, no
 * sample rewritten on disk.
 */

const SAMPLES_DIR = join(__dirname, '../../../../tests/e2e/samples')

/** A deterministic YAML serializer. The byte-stable properties under test
 * hold for any serializer that preserves object insertion order (both the
 * `yaml` package and the app's `js-yaml` do), applied identically to each
 * side of a comparison. */
function dumpYaml(content: unknown): string {
  return stringifyYaml(content, { lineWidth: 0 })
}

/** Reproduce the renderer's single-file save pipeline in memory: parse →
 * rehydrate (`processAfterDeserialization`) → JSON clone (what the reactive
 * tree goes through on save) → `prepareForSerialization` → YAML. Operates on
 * the `{ collections }` document only, exactly like the renderer (the main
 * process re-appends `_projectUuid`). */
function saveDocument(collections: unknown): string {
  const rehydrated = processAfterDeserialization(collections)
  const plain = JSON.parse(JSON.stringify({ collections: rehydrated })) as Record<string, unknown>
  return dumpYaml(prepareForSerialization(plain))
}

function loadCollections(rawYaml: string): unknown {
  const parsed = parseYaml(rawYaml) as { collections?: unknown } | null
  return Array.isArray(parsed?.collections) ? parsed.collections : []
}

/** Recursively rebuild every object with its keys in REVERSED order — a
 * stand-in for "another build inserted these same fields in a different
 * order". Array element order (which is meaningful) is preserved. */
function reverseKeys<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map((v: unknown) => reverseKeys(v)) as T
  const record = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key])
  return out as T
}

function listRestormSamples(): string[] {
  return readdirSync(SAMPLES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.restorm'))
    .map((e) => e.name)
    .sort()
}

const SAMPLES = listRestormSamples()

describe('canonicalizeSerializedKeys — key-order contract', () => {
  it('emits priority keys first in list order, then the rest in Unicode order', () => {
    const scrambled = {
      zeta: 1,
      url: 'u',
      alpha: 2,
      id: 'x',
      method: 'GET',
      name: 'n',
      type: 'http',
      beta: 3
    }
    expect(Object.keys(canonicalizeSerializedKeys(scrambled))).toEqual([
      // priority list order
      'id',
      'name',
      'type',
      'method',
      'url',
      // remaining, ascending Unicode
      'alpha',
      'beta',
      'zeta'
    ])
  })

  it('recurses into nested objects and preserves array element order', () => {
    const input = {
      items: [
        { url: 'b', id: '2', name: 'second' },
        { url: 'a', id: '1', name: 'first' }
      ],
      id: 'root'
    }
    const out = canonicalizeSerializedKeys(input)
    // Object keys reordered at every depth…
    expect(Object.keys(out)).toEqual(['id', 'items'])
    expect(Object.keys(out.items[0] ?? {})).toEqual(['id', 'name', 'url'])
    // …but array order is untouched (item ordering is meaningful).
    expect(out.items.map((i) => i.id)).toEqual(['2', '1'])
  })

  it('is idempotent — canonical input serializes identically', () => {
    const once = canonicalizeSerializedKeys({ b: 1, id: 'x', a: 2 })
    expect(canonicalizeSerializedKeys(once)).toEqual(once)
    expect(JSON.stringify(canonicalizeSerializedKeys(once))).toBe(JSON.stringify(once))
  })

  it('leaves primitives and null untouched', () => {
    expect(canonicalizeSerializedKeys('s')).toBe('s')
    expect(canonicalizeSerializedKeys(42)).toBe(42)
    expect(canonicalizeSerializedKeys(null)).toBeNull()
  })

  it('exposes the priority list as a stable contract', () => {
    expect(CANONICAL_KEY_PRIORITY).toEqual([
      'id', 'name', 'key', 'type', 'folderType', 'method', 'url', 'fileFormatVersion'
    ])
  })

  it('puts the document format version above the collections it applies to', () => {
    // Alphabetically it would sort after `collections`, i.e. below the
    // entire project — a format stamp nobody sees is a format stamp that
    // gets missed.
    const out = canonicalizeSerializedKeys({ collections: [], _projectUuid: 'u', fileFormatVersion: 1 })
    expect(Object.keys(out)).toEqual(['fileFormatVersion', '_projectUuid', 'collections'])
  })
})

describe('project serialization — round-trip stability on reference samples', () => {
  it('finds the reference samples', () => {
    expect(SAMPLES.length).toBeGreaterThan(0)
  })

  it.each(SAMPLES)('open→save is a byte-stable fixed point: %s', (fileName) => {
    const raw = readFileSync(join(SAMPLES_DIR, fileName), 'utf-8')

    // A file written by THIS build (S1) reopened and saved again (S2) must be
    // byte-identical — the guard for "an unmodified save changes nothing".
    const s1 = saveDocument(loadCollections(raw))
    const s2 = saveDocument(loadCollections(s1))
    expect(s2).toBe(s1)
  })

  it.each(SAMPLES)('the FIRST save is already a fixed point across processes: %s', (fileName) => {
    const raw = readFileSync(join(SAMPLES_DIR, fileName), 'utf-8')

    // Stronger than the fixed point above, which starts from a document
    // already backfilled once: two INDEPENDENT load→save pipelines over the
    // raw bytes must agree. This is what two colleagues opening the same
    // legacy file on two machines do, and what the git engines rely on —
    // they parse the same bytes twice and pair the entities BY ID. A random
    // backfill made these two byte streams differ on every entity that has
    // no persisted id yet.
    expect(saveDocument(loadCollections(raw))).toBe(saveDocument(loadCollections(raw)))
  })
})

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('project serialization — insertion-order independence (cross-build churn)', () => {
  it.each(SAMPLES)('same data in a different key order serializes identically: %s', (fileName) => {
    const raw = readFileSync(join(SAMPLES_DIR, fileName), 'utf-8')
    // Both sides go through their OWN load: the id backfill is derived from
    // the document, not random, so it no longer has to be neutralised by
    // sharing one pre-backfilled baseline. Shuffling the keys BEFORE the
    // load also proves the derivation itself ignores key order — a
    // key-order-sensitive path would give the two builds different ids.
    const stable = clone({ collections: processAfterDeserialization(loadCollections(raw)) })
    const shuffled = clone({ collections: processAfterDeserialization(reverseKeys(loadCollections(raw))) })

    // Sanity: the shuffle really did change the in-memory key order, so this
    // test would be RED without the canonical ordering (it models build A's
    // file order vs build B's rebuilt order for the SAME data).
    expect(dumpYaml(shuffled)).not.toBe(dumpYaml(stable))

    // …yet after canonicalization both serialize to the same bytes.
    // (Clone per call — `prepareForSerialization` normalizes values in place.)
    expect(dumpYaml(prepareForSerialization(clone(shuffled)))).toBe(
      dumpYaml(prepareForSerialization(clone(stable)))
    )
  })
})

describe('semantic git diff — a shape-only change is not a modification', () => {
  it.each(SAMPLES)('reordering keys reports zero entity changes: %s', (fileName) => {
    const raw = readFileSync(join(SAMPLES_DIR, fileName), 'utf-8')
    const before = parseProjectYaml(raw)
    if (before.length === 0) return // not a project document

    // "after" holds the exact same entities, only every object's keys are in
    // a different insertion order — the situation that made the commit diff
    // list every entity as Modified.
    const after = reverseKeys(before)
    expect(diffProjectEntities(before, after)).toEqual([])
  })
})
