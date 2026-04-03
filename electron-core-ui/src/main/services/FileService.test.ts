import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null)
  }
}))

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  statSync: vi.fn()
}))

// Mock crypto
vi.mock('crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn((_encoding: string) => {
      // Return a deterministic hash based on the input
      // The mock captures the input via closure
      return `mock-hash-${hashCounter++}`
    })
  }))
}))

let hashCounter = 0

// Mock logger
vi.mock('./LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

// Mock StorageService
vi.mock('./StorageService', () => ({
  getStorageService: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    delete: vi.fn()
  }))
}))

// Mock EventBusService
vi.mock('./EventBusService', () => ({
  eventBusService: {
    subscribe: vi.fn(),
    emit: vi.fn(),
    unsubscribe: vi.fn()
  }
}))

// Mock I18nService
vi.mock('./I18nService', () => ({
  i18nService: {
    t: vi.fn((key: string) => key)
  }
}))

// Mock js-yaml
vi.mock('js-yaml', () => ({
  default: {
    load: vi.fn(),
    dump: vi.fn()
  }
}))

import { createHash } from 'crypto'
import { FileService } from './FileService'

/**
 * Create a FileService with a real crypto-based hash for deterministic testing.
 * We override the createHash mock per-test to produce content-based hashes.
 */
function setupDeterministicHashing(): void {
  // Use a simple counter-free approach: hash = hex of JSON content
  vi.mocked(createHash).mockImplementation(() => {
    let inputData = ''
    const hasher = {
      update: vi.fn((data: string) => {
        inputData = data
        return hasher
      }),
      digest: vi.fn(() => {
        // Simple deterministic "hash": take first 64 chars of input
        // or pad with zeros. This is enough to detect uniqueness.
        let hash = ''
        for (let i = 0; i < inputData.length && hash.length < 64; i++) {
          hash += inputData.charCodeAt(i).toString(16)
        }
        return hash.padEnd(64, '0').slice(0, 64)
      })
    }
    return hasher as unknown as ReturnType<typeof createHash>
  })
}

describe('FileService – checksum-based dirty state tracking', () => {
  let service: FileService

  beforeEach(() => {
    vi.clearAllMocks()
    hashCounter = 0
    setupDeterministicHashing()
    service = new FileService({ storagePrefix: 'test_' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // registerInitialChecksums()
  // ---------------------------------------------------------------
  describe('registerInitialChecksums()', () => {
    it('sets clean state – isDirty is false after registration', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'Folder A' }],
        ['obj-2', { name: 'Request B' }]
      ])

      service.registerInitialChecksums(objects)

      expect(service.isDirty()).toBe(false)
      const details = service.getDirtyStateDetails()
      expect(details.isDirty).toBe(false)
      expect(details.changedIds).toEqual([])
      expect(details.newIds).toEqual([])
      expect(details.deletedIds).toEqual([])
    })

    it('replaces previous checksums on re-registration', () => {
      const objects1 = new Map<string, unknown>([
        ['obj-1', { name: 'A' }]
      ])
      service.registerInitialChecksums(objects1)

      // Modify obj-1 to make it dirty
      service.updateObjectChecksum('obj-1', { name: 'A-modified' })
      expect(service.isDirty()).toBe(true)

      // Re-register with new baseline – should be clean again
      const objects2 = new Map<string, unknown>([
        ['obj-1', { name: 'A-modified' }]
      ])
      service.registerInitialChecksums(objects2)
      expect(service.isDirty()).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // updateObjectChecksum()
  // ---------------------------------------------------------------
  describe('updateObjectChecksum()', () => {
    it('marks dirty when checksum changes from saved state', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'Original' }]
      ])
      service.registerInitialChecksums(objects)

      service.updateObjectChecksum('obj-1', { name: 'Modified' })

      expect(service.isDirty()).toBe(true)
      const details = service.getDirtyStateDetails()
      expect(details.changedIds).toContain('obj-1')
    })

    it('stays clean when updating with identical data', () => {
      const data = { name: 'Same' }
      const objects = new Map<string, unknown>([['obj-1', data]])
      service.registerInitialChecksums(objects)

      // Update with the same data – should remain clean
      service.updateObjectChecksum('obj-1', { name: 'Same' })
      expect(service.isDirty()).toBe(false)
    })

    it('reverts to clean when object is restored to saved state', () => {
      const original = { name: 'Original' }
      const objects = new Map<string, unknown>([['obj-1', original]])
      service.registerInitialChecksums(objects)

      // Modify
      service.updateObjectChecksum('obj-1', { name: 'Changed' })
      expect(service.isDirty()).toBe(true)

      // Restore original data
      service.updateObjectChecksum('obj-1', { name: 'Original' })
      expect(service.isDirty()).toBe(false)
    })

    it('tracks a new object (not in saved state) as new', () => {
      const objects = new Map<string, unknown>([['obj-1', { name: 'A' }]])
      service.registerInitialChecksums(objects)

      service.updateObjectChecksum('obj-new', { name: 'Brand New' })

      expect(service.isDirty()).toBe(true)
      const details = service.getDirtyStateDetails()
      expect(details.newIds).toContain('obj-new')
    })
  })

  // ---------------------------------------------------------------
  // commitChecksums()
  // ---------------------------------------------------------------
  describe('commitChecksums()', () => {
    it('resets to clean after committing modified checksums', () => {
      const objects = new Map<string, unknown>([['obj-1', { name: 'A' }]])
      service.registerInitialChecksums(objects)

      service.updateObjectChecksum('obj-1', { name: 'A-modified' })
      expect(service.isDirty()).toBe(true)

      service.commitChecksums()
      expect(service.isDirty()).toBe(false)
    })

    it('resets to clean after committing with new objects', () => {
      const objects = new Map<string, unknown>([['obj-1', { name: 'A' }]])
      service.registerInitialChecksums(objects)

      service.updateObjectChecksum('obj-2', { name: 'New Object' })
      expect(service.isDirty()).toBe(true)

      service.commitChecksums()
      expect(service.isDirty()).toBe(false)

      // Now modifying obj-2 from its committed state should make dirty
      service.updateObjectChecksum('obj-2', { name: 'New Object v2' })
      expect(service.isDirty()).toBe(true)
    })

    it('resets to clean after committing with deleted objects', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'A' }],
        ['obj-2', { name: 'B' }]
      ])
      service.registerInitialChecksums(objects)

      service.removeObjectChecksum('obj-2')
      expect(service.isDirty()).toBe(true)

      service.commitChecksums()
      expect(service.isDirty()).toBe(false)

      // obj-2 should no longer be tracked at all
      const details = service.getDirtyStateDetails()
      expect(details.deletedIds).toEqual([])
    })
  })

  // ---------------------------------------------------------------
  // getDirtyStateDetails()
  // ---------------------------------------------------------------
  describe('getDirtyStateDetails()', () => {
    it('returns correct changed IDs', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'A' }],
        ['obj-2', { name: 'B' }],
        ['obj-3', { name: 'C' }]
      ])
      service.registerInitialChecksums(objects)

      service.updateObjectChecksum('obj-2', { name: 'B-changed' })

      const details = service.getDirtyStateDetails()
      expect(details.isDirty).toBe(true)
      expect(details.changedIds).toEqual(['obj-2'])
      expect(details.newIds).toEqual([])
      expect(details.deletedIds).toEqual([])
    })

    it('returns correct new IDs', () => {
      const objects = new Map<string, unknown>([['obj-1', { name: 'A' }]])
      service.registerInitialChecksums(objects)

      service.updateObjectChecksum('obj-new-1', { name: 'New 1' })
      service.updateObjectChecksum('obj-new-2', { name: 'New 2' })

      const details = service.getDirtyStateDetails()
      expect(details.isDirty).toBe(true)
      expect(details.newIds).toContain('obj-new-1')
      expect(details.newIds).toContain('obj-new-2')
      expect(details.changedIds).toEqual([])
      expect(details.deletedIds).toEqual([])
    })

    it('returns correct deleted IDs', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'A' }],
        ['obj-2', { name: 'B' }]
      ])
      service.registerInitialChecksums(objects)

      service.removeObjectChecksum('obj-1')

      const details = service.getDirtyStateDetails()
      expect(details.isDirty).toBe(true)
      expect(details.deletedIds).toEqual(['obj-1'])
      expect(details.changedIds).toEqual([])
      expect(details.newIds).toEqual([])
    })

    it('returns all categories when mixed changes exist', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'A' }],
        ['obj-2', { name: 'B' }],
        ['obj-3', { name: 'C' }]
      ])
      service.registerInitialChecksums(objects)

      service.updateObjectChecksum('obj-1', { name: 'A-modified' }) // changed
      service.removeObjectChecksum('obj-2')                         // deleted
      service.updateObjectChecksum('obj-4', { name: 'D' })          // new

      const details = service.getDirtyStateDetails()
      expect(details.isDirty).toBe(true)
      expect(details.changedIds).toContain('obj-1')
      expect(details.deletedIds).toContain('obj-2')
      expect(details.newIds).toContain('obj-4')
    })

    it('returns clean state when no changes exist', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'A' }],
        ['obj-2', { name: 'B' }]
      ])
      service.registerInitialChecksums(objects)

      const details = service.getDirtyStateDetails()
      expect(details.isDirty).toBe(false)
      expect(details.changedIds).toEqual([])
      expect(details.newIds).toEqual([])
      expect(details.deletedIds).toEqual([])
    })
  })

  // ---------------------------------------------------------------
  // removeObjectChecksum()
  // ---------------------------------------------------------------
  describe('removeObjectChecksum()', () => {
    it('marks an existing object as deleted', () => {
      const objects = new Map<string, unknown>([
        ['obj-1', { name: 'A' }],
        ['obj-2', { name: 'B' }]
      ])
      service.registerInitialChecksums(objects)

      service.removeObjectChecksum('obj-1')

      expect(service.isDirty()).toBe(true)
      const details = service.getDirtyStateDetails()
      expect(details.deletedIds).toEqual(['obj-1'])
    })

    it('removing a new object (not saved) returns to clean', () => {
      const objects = new Map<string, unknown>([['obj-1', { name: 'A' }]])
      service.registerInitialChecksums(objects)

      // Add a new object then remove it
      service.updateObjectChecksum('obj-new', { name: 'Temp' })
      expect(service.isDirty()).toBe(true)

      service.removeObjectChecksum('obj-new')
      expect(service.isDirty()).toBe(false)
    })

    it('removing an unknown object does not crash', () => {
      const objects = new Map<string, unknown>([['obj-1', { name: 'A' }]])
      service.registerInitialChecksums(objects)

      // Should not throw
      service.removeObjectChecksum('nonexistent')

      // Still clean since the ID wasn't in saved checksums either
      expect(service.isDirty()).toBe(false)
    })
  })
})
