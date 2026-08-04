import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { deserialize } from 'electron-core-ui/main'
import {
  CURRENT_FILE_FORMAT_VERSION,
  FILE_FORMAT_VERSION_KEY
} from '../../src/shared/config/fileFormatVersion'

/**
 * The `.restorm` files committed to this repo are the shape the product
 * is demonstrated in — the samples a new user opens, and the fixtures
 * every e2e scenario reads. When the format changes, they are what stops
 * the repo from going on showing the old one, and the only place a
 * reviewer can see the intended shape without running the app.
 *
 * The version describes the FILE, so it belongs at the root. A committed
 * file declaring it on a collection would keep the previous placement
 * alive in the one place people copy from.
 */

const RESTORM_ROOT = join(__dirname, '..', '..')
const SAMPLE_ROOTS = [join(RESTORM_ROOT, 'Samples'), join(RESTORM_ROOT, 'tests', 'e2e', 'samples')]

function findRestormFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...findRestormFiles(full))
    else if (entry.endsWith('.restorm')) found.push(full)
  }
  return found
}

interface Sample {
  name: string
  root: unknown
  collections: unknown[]
}

const samples: Sample[] = SAMPLE_ROOTS.flatMap(findRestormFiles).map((file) => {
  const parsed: unknown = deserialize(readFileSync(file, 'utf-8'), 'yaml')
  const root = (parsed ?? {}) as Record<string, unknown>
  const collections = root['collections']
  return {
    name: relative(RESTORM_ROOT, file),
    root,
    collections: Array.isArray(collections) ? collections : []
  }
})

function declaredOn(node: unknown): unknown {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  return (node as Record<string, unknown>)[FILE_FORMAT_VERSION_KEY]
}

describe('committed .restorm samples declare their format version at the root', () => {
  it('finds the committed samples', () => {
    expect(samples.length).toBeGreaterThan(0)
    // A sample with collections is what makes the per-collection
    // assertion below mean anything.
    expect(samples.some((s) => s.collections.length > 0)).toBe(true)
  })

  it('at least one sample declares a version, so the assertions are not vacuous', () => {
    expect(samples.filter((s) => typeof declaredOn(s.root) === 'number').length).toBeGreaterThan(0)
  })

  it('no sample carries the version on a collection', () => {
    const offenders = samples
      .filter((s) => s.collections.some((c) => declaredOn(c) !== undefined))
      .map((s) => s.name)
    expect(offenders, 'the version describes the file, so it belongs at the root').toEqual([])
  })

  it('every declared version is a number this build can open', () => {
    for (const sample of samples) {
      const declared = declaredOn(sample.root)
      if (declared === undefined) continue
      expect(typeof declared, `${sample.name} declares a non-numeric version`).toBe('number')
      expect(declared as number, `${sample.name} declares a version this build refuses`)
        .toBeLessThanOrEqual(CURRENT_FILE_FORMAT_VERSION)
    }
  })
})
