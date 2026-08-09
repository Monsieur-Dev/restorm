/**
 * Tests for PersistenceService utilities
 */

import { describe, it, expect } from 'vitest'
import {
  serialize,
  deserialize,
  detectFormat
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

})
