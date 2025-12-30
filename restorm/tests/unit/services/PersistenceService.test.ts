/**
 * Tests for PersistenceService utilities
 */

import { describe, it, expect } from 'vitest'
import {
  serialize,
  deserialize,
  detectFormat,
  sanitizeFileName,
  calculateIndexPadding,
  generateIndexedFileName
} from 'electron-core-ui/main'

describe('PersistenceService utilities', () => {
  describe('serialize/deserialize', () => {
    it('should serialize to JSON', () => {
      const data = { name: 'Test', value: 123 }
      const result = serialize(data, 'json')
      expect(result).toContain('"name"')
      expect(result).toContain('"Test"')
    })

    it('should serialize to JSON5', () => {
      const data = { name: 'Test', value: 123 }
      const result = serialize(data, 'json5')
      expect(result).toContain('name')
    })

    it('should serialize to YAML', () => {
      const data = { name: 'Test', value: 123 }
      const result = serialize(data, 'yaml')
      expect(result).toContain('name:')
    })

    it('should deserialize from JSON', () => {
      const json = '{"name": "Test", "value": 123}'
      const result = deserialize(json, 'json')
      expect(result).toEqual({ name: 'Test', value: 123 })
    })

    it('should deserialize from JSON5', () => {
      const json5 = '{name: "Test", value: 123}'
      const result = deserialize(json5, 'json5')
      expect(result).toEqual({ name: 'Test', value: 123 })
    })

    it('should deserialize from YAML', () => {
      const yaml = 'name: Test\nvalue: 123'
      const result = deserialize(yaml, 'yaml')
      expect(result).toEqual({ name: 'Test', value: 123 })
    })
  })

  describe('detectFormat', () => {
    it('should detect JSON format', () => {
      expect(detectFormat('file.json')).toBe('json')
    })

    it('should detect JSON5 format', () => {
      expect(detectFormat('file.json5')).toBe('json5')
    })

    it('should detect YAML format', () => {
      expect(detectFormat('file.yaml')).toBe('yaml')
      expect(detectFormat('file.yml')).toBe('yaml')
    })

    it('should default to JSON for unknown extensions', () => {
      expect(detectFormat('file.restorm')).toBe('json')
    })
  })

  describe('sanitizeFileName', () => {
    it('should remove invalid characters', () => {
      const result = sanitizeFileName('test<>:"/\\|?*file')
      // Each invalid char (<>:"/\|?*) is replaced with _
      expect(result).toMatch(/test_+file/)
      expect(result).not.toContain('<')
      expect(result).not.toContain('>')
      expect(result).not.toContain(':')
    })

    it('should trim whitespace', () => {
      expect(sanitizeFileName('  test file  ')).toBe('test file')
    })

    it('should normalize multiple spaces', () => {
      expect(sanitizeFileName('test   file')).toBe('test file')
    })
  })

  describe('calculateIndexPadding', () => {
    it('should return minimum of 2 digits', () => {
      expect(calculateIndexPadding(5)).toBe(2)
      expect(calculateIndexPadding(9)).toBe(2)
    })

    it('should return 2 for counts up to 99', () => {
      expect(calculateIndexPadding(10)).toBe(2)
      expect(calculateIndexPadding(99)).toBe(2)
    })

    it('should return 3 for counts up to 999', () => {
      expect(calculateIndexPadding(100)).toBe(3)
      expect(calculateIndexPadding(999)).toBe(3)
    })

    it('should return 4 for counts up to 9999', () => {
      expect(calculateIndexPadding(1000)).toBe(4)
    })
  })

  describe('generateIndexedFileName', () => {
    it('should generate file name with index', () => {
      const result = generateIndexedFileName(
        { document: { name: 'Test', type: 'POST' }, index: 0, totalCount: 10 },
        { pattern: '{index} - {type} - {name}', typeProperty: 'type', nameProperty: 'name' }
      )
      expect(result).toBe('01 - POST - Test')
    })

    it('should handle missing type gracefully', () => {
      const result = generateIndexedFileName(
        { document: { name: 'Test' }, index: 0, totalCount: 10 },
        { pattern: '{index} - {name}', nameProperty: 'name' }
      )
      expect(result).toBe('01 - Test')
    })

    it('should use fallback for missing config', () => {
      const result = generateIndexedFileName(
        { document: { name: 'Test Item' }, index: 2, totalCount: 10 }
      )
      expect(result).toBe('03 - Test Item')
    })

    it('should pad index based on total count', () => {
      const result = generateIndexedFileName(
        { document: { name: 'Test' }, index: 0, totalCount: 100 },
        { pattern: '{index} - {name}', nameProperty: 'name' }
      )
      expect(result).toBe('001 - Test')
    })
  })
})

