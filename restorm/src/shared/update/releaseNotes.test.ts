import { describe, it, expect } from 'vitest'
import { compareVersions, countSectionsNewerThan } from './releaseNotes'
import type { ReleaseNoteSection } from './updateTypes'

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })
  it('tolerates a v-prefix and a prerelease suffix', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.3.0-rc.1', '1.2.9')).toBeGreaterThan(0)
  })
  it('treats an unparseable version as equal (never reorders)', () => {
    expect(compareVersions('not-a-version', '1.0.0')).toBe(0)
  })
})

describe('countSectionsNewerThan', () => {
  const sections: ReleaseNoteSection[] = [
    { version: '3.0.0', markdown: '' },
    { version: '2.1.0', markdown: '' },
    { version: '2.0.0', markdown: '' },
    { version: '1.0.0', markdown: '' }
  ]
  it('counts only strictly-newer sections', () => {
    expect(countSectionsNewerThan(sections, '2.0.0')).toBe(2) // 3.0.0, 2.1.0
    expect(countSectionsNewerThan(sections, '0.9.0')).toBe(4)
    expect(countSectionsNewerThan(sections, '3.0.0')).toBe(0)
  })
})
