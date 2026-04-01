import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/fake/userData')
  }
}))

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

// Mock logger
vi.mock('./LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { StorageService } from './StorageService'

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------
  // Load from existing file
  // ---------------------------------------------------------------
  describe('load from existing file', () => {
    it('loads data from a valid JSON file', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ theme: 'dark', lang: 'en' }))

      const service = new StorageService('test.json')

      expect(service.get('theme')).toBe('dark')
      expect(service.get('lang')).toBe('en')
    })
  })

  // ---------------------------------------------------------------
  // Load from missing file
  // ---------------------------------------------------------------
  describe('load from missing file', () => {
    it('returns empty store when file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)

      const service = new StorageService('missing.json')

      expect(service.getAll()).toEqual({})
    })
  })

  // ---------------------------------------------------------------
  // get / set / has / delete / getAll
  // ---------------------------------------------------------------
  describe('get/set/has/delete/getAll', () => {
    let service: StorageService

    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(false)
      service = new StorageService('store.json')
      // After constructor, reset mocks so we can inspect save calls
      vi.mocked(writeFileSync).mockClear()
      vi.mocked(existsSync).mockClear()
    })

    it('set stores and get retrieves a value', () => {
      vi.mocked(existsSync).mockReturnValue(true) // dir exists
      service.set('key', 'value')
      expect(service.get('key')).toBe('value')
    })

    it('has returns true for existing key', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      service.set('exists', true)
      expect(service.has('exists')).toBe(true)
    })

    it('has returns false for missing key', () => {
      expect(service.has('nope')).toBe(false)
    })

    it('get returns undefined for missing key', () => {
      expect(service.get('nope')).toBeUndefined()
    })

    it('delete removes a key', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      service.set('del', 123)
      service.delete('del')
      expect(service.has('del')).toBe(false)
      expect(service.get('del')).toBeUndefined()
    })

    it('delete on non-existent key does not save', () => {
      service.delete('nonexistent')
      expect(writeFileSync).not.toHaveBeenCalled()
    })

    it('getAll returns a copy of all data', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      service.set('a', 1)
      service.set('b', 2)
      const all = service.getAll()
      expect(all).toEqual({ a: 1, b: 2 })

      // Mutating the copy should not affect internal state
      all['c'] = 3
      expect(service.has('c')).toBe(false)
    })
  })

  // ---------------------------------------------------------------
  // Save creates directory if needed
  // ---------------------------------------------------------------
  describe('save creates directory', () => {
    it('creates parent directory when it does not exist', () => {
      // First call: constructor load check (file doesn't exist)
      vi.mocked(existsSync).mockReturnValueOnce(false)

      const service = new StorageService('store.json')

      // For the save: dir doesn't exist
      vi.mocked(existsSync).mockReturnValueOnce(false)

      service.set('key', 'val')

      expect(mkdirSync).toHaveBeenCalledWith('/fake/userData', { recursive: true })
      expect(writeFileSync).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------
  describe('error handling', () => {
    it('handles corrupted JSON file gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('not valid json{{{')

      const service = new StorageService('bad.json')
      expect(service.getAll()).toEqual({})
    })
  })
})
