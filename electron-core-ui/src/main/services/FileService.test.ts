import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  statSync: vi.fn()
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('./StorageService', () => ({
  getStorageService: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    has: vi.fn(),
    delete: vi.fn()
  }))
}))

vi.mock('./I18nService', () => ({ i18nService: { t: vi.fn((k: string) => k) } }))

vi.mock('js-yaml', () => ({ default: { load: vi.fn(), dump: vi.fn() } }))

import { FileService } from './FileService'

/**
 * Dirty-state behaviour now lives entirely in the save-unit registry.
 * These tests exercise the cached `currentFile.isDirty` flag which the
 * registry bridge is expected to keep in sync with "any unit dirty".
 */

describe('FileService — registry-backed dirty state', () => {
  let service: FileService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new FileService({ storagePrefix: 'test_' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isDirty()', () => {
    it('starts clean with no units registered', () => {
      expect(service.isDirty()).toBe(false)
    })

    it('is clean after hydrating a unit against its reference', () => {
      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } })
      expect(service.isDirty()).toBe(false)
    })

    it('flips to dirty when any unit becomes dirty', () => {
      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } })
      registry.mutate('a', { name: 'v2' })
      expect(service.isDirty()).toBe(true)
    })

    it('stays dirty while at least one unit remains dirty', () => {
      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } })
      registry.hydrate({ runtimeId: 'b', kind: 'file', reference: { name: 'v1' } })
      registry.mutate('a', { name: 'v2' })
      registry.mutate('b', { name: 'v2' })
      registry.commit('a')
      expect(service.isDirty()).toBe(true)
    })

    it('flips to clean once the last dirty unit is committed', () => {
      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } })
      registry.mutate('a', { name: 'v2' })
      expect(service.isDirty()).toBe(true)
      registry.commit('a')
      expect(service.isDirty()).toBe(false)
    })

    it('flips to clean on revert', () => {
      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } })
      registry.mutate('a', { name: 'v2' })
      registry.revert('a')
      expect(service.isDirty()).toBe(false)
    })

    it('treats a markDeleted unit as dirty until committed', () => {
      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { name: 'v1' } })
      registry.markDeleted('a')
      expect(service.isDirty()).toBe(true)
      registry.commit('a')
      expect(service.isDirty()).toBe(false)
    })
  })

  describe('dirtyChange notifications', () => {
    it('fires the callback exactly on false→true and true→false transitions', () => {
      const listener = vi.fn()
      service.onDirtyChanged(listener)

      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { v: 1 } })

      // Hydrating a clean unit shouldn't fire (we were already clean).
      expect(listener).not.toHaveBeenCalled()

      registry.mutate('a', { v: 2 })
      expect(listener).toHaveBeenCalledWith(true)

      // A second mutation that keeps us dirty shouldn't re-notify.
      registry.mutate('a', { v: 3 })
      expect(listener).toHaveBeenCalledTimes(1)

      registry.commit('a')
      expect(listener).toHaveBeenLastCalledWith(false)
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })

  describe('close()', () => {
    it('drops the registry and resets the cached dirty flag', () => {
      const registry = service.getSaveUnitRegistry()
      registry.hydrate({ runtimeId: 'a', kind: 'file', reference: { v: 1 } })
      registry.mutate('a', { v: 2 })
      expect(service.isDirty()).toBe(true)

      service.close()

      expect(service.isDirty()).toBe(false)
      expect(service.getSaveUnitRegistry().list()).toHaveLength(0)
    })
  })
})
