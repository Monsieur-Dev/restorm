import { describe, it, expect } from 'vitest'
import {
  compareSpecAgainstStored,
  expandHeaderTemplate,
  expandVariables,
  isApiUpdateDue
} from '../../src/main/services/apiUpdate/scheduling'
import type { ApiUpdateConfig } from '../../src/shared/types/baseTypes'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function config(partial: Partial<ApiUpdateConfig> = {}): ApiUpdateConfig {
  return {
    sourceUrl: 'https://example/spec.json',
    autoCheckEnabled: true,
    interval: 'daily',
    ...partial
  }
}

describe('isApiUpdateDue', () => {
  it('returns false when no config is present', () => {
    expect(isApiUpdateDue(undefined, Date.now())).toBe(false)
  })

  it('returns false when autoCheckEnabled is off', () => {
    expect(isApiUpdateDue(config({ autoCheckEnabled: false, lastCheckedAt: 0 }), Date.now())).toBe(false)
  })

  it('returns false when interval is "never"', () => {
    // Pin the explicit opt-out — the user picked "Never" precisely
    // because they don't want any auto-check, and the scheduler
    // should respect that even if the folder has never been checked.
    expect(isApiUpdateDue(config({ interval: 'never' }), Date.now())).toBe(false)
  })

  it('returns true on the very first check (lastCheckedAt undefined)', () => {
    expect(isApiUpdateDue(config(), Date.now())).toBe(true)
  })

  it('respects the daily interval', () => {
    const lastCheckedAt = 1_000_000
    // Just under a day — not due yet.
    expect(isApiUpdateDue(config({ lastCheckedAt }), lastCheckedAt + DAY - 1)).toBe(false)
    // Exactly a day — due (the spec says "lastCheckedAt + interval <= now").
    expect(isApiUpdateDue(config({ lastCheckedAt }), lastCheckedAt + DAY)).toBe(true)
    // Way past — also due.
    expect(isApiUpdateDue(config({ lastCheckedAt }), lastCheckedAt + 2 * DAY)).toBe(true)
  })

  it('respects the hourly interval', () => {
    const lastCheckedAt = 1_000_000
    expect(isApiUpdateDue(config({ interval: 'hourly', lastCheckedAt }), lastCheckedAt + HOUR - 1)).toBe(false)
    expect(isApiUpdateDue(config({ interval: 'hourly', lastCheckedAt }), lastCheckedAt + HOUR)).toBe(true)
  })
})

describe('compareSpecAgainstStored', () => {
  it('returns firstCheck when nothing is persisted yet', () => {
    expect(compareSpecAgainstStored({ fetchedHash: 'h1' }))
      .toEqual({ status: 'firstCheck' })
  })

  it('returns unchanged when both version and hash match', () => {
    expect(compareSpecAgainstStored({
      fetchedVersion: '1.0.0',
      fetchedHash: 'h1',
      storedVersion: '1.0.0',
      storedHash: 'h1'
    })).toEqual({ status: 'unchanged' })
  })

  it('flags a version bump when only the version changed', () => {
    expect(compareSpecAgainstStored({
      fetchedVersion: '1.1.0',
      fetchedHash: 'h1',
      storedVersion: '1.0.0',
      storedHash: 'h1'
    })).toEqual({ status: 'updateAvailable', reason: 'version' })
  })

  it('flags a content change when only the hash changed', () => {
    // Spec authors who don't bump info.version on every change rely
    // on this branch — without it, real changes would silently slip
    // through. Pinned by the ticket's "compare both" requirement.
    expect(compareSpecAgainstStored({
      fetchedVersion: '1.0.0',
      fetchedHash: 'h2',
      storedVersion: '1.0.0',
      storedHash: 'h1'
    })).toEqual({ status: 'updateAvailable', reason: 'hash' })
  })

  it('reports both when version AND hash changed', () => {
    expect(compareSpecAgainstStored({
      fetchedVersion: '1.1.0',
      fetchedHash: 'h2',
      storedVersion: '1.0.0',
      storedHash: 'h1'
    })).toEqual({ status: 'updateAvailable', reason: 'both' })
  })
})

describe('expandVariables', () => {
  it('substitutes ${VAR} occurrences from the variable map', () => {
    expect(expandVariables('https://${HOST}/api/${VERSION}', { HOST: 'example.com', VERSION: 'v2' }))
      .toBe('https://example.com/api/v2')
  })

  it('leaves unknown placeholders unchanged so the failure surfaces in the fetch error', () => {
    // Silently expanding to '' would mask a typo or missing env var
    // and produce a confusing "could not parse spec" error instead
    // of "URL contains an unresolved variable". Pin the explicit
    // pass-through.
    expect(expandVariables('https://${MISSING}/api', {})).toBe('https://${MISSING}/api')
  })
})

describe('expandHeaderTemplate', () => {
  it('expands ${VAR} in header values, leaves keys untouched', () => {
    expect(expandHeaderTemplate({ Authorization: 'Bearer ${TOKEN}' }, { TOKEN: 'abc' }))
      .toEqual({ Authorization: 'Bearer abc' })
  })

  it('returns an empty map for missing headers', () => {
    expect(expandHeaderTemplate(undefined, { TOKEN: 'x' })).toEqual({})
  })
})
