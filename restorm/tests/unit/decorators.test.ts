/**
 * Tests for TypeScript Decorators utilities
 * 
 * Note: Decorator tests with actual @ syntax require special TypeScript config.
 * These tests focus on the utility functions that decorators use.
 */

import { describe, it, expect } from 'vitest'
import {
  generateFileName,
  serializeWithDecorators,
  getNonSerialisedProperties
} from 'electron-core-ui/main'

describe('Decorator utilities', () => {
  describe('generateFileName', () => {
    it('should return fallback name when no config', () => {
      const fileName = generateFileName(
        {},  // Empty target (no config)
        { name: 'Test Item', id: '123' },
        0,
        10
      )
      // Should use fallback which is the name property
      expect(fileName).toContain('Test Item')
    })

    it('should handle missing name property gracefully', () => {
      const fileName = generateFileName(
        {},
        { id: 'abc' },  // No name
        0,
        10
      )
      expect(fileName.length).toBeGreaterThan(0)
    })
  })

  describe('getNonSerialisedProperties', () => {
    it('should return empty set for class without decorators', () => {
      class PlainClass {}
      const props = getNonSerialisedProperties(PlainClass)
      expect(props.size).toBe(0)
    })
  })

  describe('serializeWithDecorators', () => {
    it('should keep all properties for class without NonSerialised', () => {
      class PlainClass {}
      const obj = { prop1: 'value', prop2: 42, prop3: true }
      const serialized = serializeWithDecorators(PlainClass, obj)
      
      expect(serialized).toEqual(obj)
    })
  })
})

