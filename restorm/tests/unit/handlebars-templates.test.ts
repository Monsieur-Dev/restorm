/**
 * Unit tests for Handlebars templates
 * Validates that all .hbs templates in the project have valid syntax
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import Handlebars from 'handlebars'

// Register all custom helpers (same as in handlebarsHelpers.ts)
beforeAll(() => {
  // Equality check helper
  Handlebars.registerHelper('eq', function (a: unknown, b: unknown): boolean {
    return a === b
  })

  // Not equal helper
  Handlebars.registerHelper('neq', function (a: unknown, b: unknown): boolean {
    return a !== b
  })

  // ifEquals block helper
  Handlebars.registerHelper('ifEquals', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
    if (a === b) {
      return options.fn(this)
    }
    return options.inverse(this)
  })

  // String manipulation helpers
  Handlebars.registerHelper('lowercase', function (str: unknown): string {
    return typeof str === 'string' ? str.toLowerCase() : ''
  })

  Handlebars.registerHelper('uppercase', function (str: unknown): string {
    return typeof str === 'string' ? str.toUpperCase() : ''
  })

  Handlebars.registerHelper('snakeCase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  })
})

/**
 * Recursively find all .hbs files in a directory
 */
function findHbsFiles(dir: string): string[] {
  const files: string[] = []
  
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    
    if (stat.isDirectory()) {
      files.push(...findHbsFiles(fullPath))
    } else if (entry.endsWith('.hbs')) {
      files.push(fullPath)
    }
  }
  
  return files
}

describe('Handlebars Templates', () => {
  const templatesDir = join(__dirname, '../../src/renderer/src/resources/templates')
  const hbsFiles = findHbsFiles(templatesDir)

  it('should find at least one template file', () => {
    expect(hbsFiles.length).toBeGreaterThan(0)
  })

  describe('Template syntax validation', () => {
    for (const filePath of hbsFiles) {
      const relativePath = relative(templatesDir, filePath)
      
      it(`should compile "${relativePath}" without errors`, () => {
        const templateContent = readFileSync(filePath, 'utf-8')
        
        // This will throw if the template has syntax errors
        expect(() => {
          const template = Handlebars.compile(templateContent)
          // Execute with empty object to ensure runtime doesn't crash
          template({})
        }).not.toThrow()
      })
    }
  })

  describe('Template compilation with sample data', () => {
    for (const filePath of hbsFiles) {
      const relativePath = relative(templatesDir, filePath)
      
      it(`should render "${relativePath}" with sample data`, () => {
        const templateContent = readFileSync(filePath, 'utf-8')
        const template = Handlebars.compile(templateContent)
        
        // Sample data that covers common template variables
        const sampleData = {
          // HTTP request data
          method: 'GET',
          url: 'https://api.example.com/test',
          headers: [{ key: 'Content-Type', value: 'application/json' }],
          body: { content: '{}' },
          queryParams: [{ key: 'id', value: '1' }],
          pathParams: [{ key: 'userId', value: '123' }],
          
          // GraphQL data
          endpoint: 'https://api.example.com/graphql',
          query: 'query { test }',
          variables: '{}',
          operationType: 'query',
          
          // gRPC data
          host: 'localhost:50051',
          package: 'example',
          serviceName: 'TestService',
          method_name: 'GetTest',
          requestType: 'TestRequest',
          requestMessage: '{}',
          metadata: [{ key: 'authorization', value: 'Bearer token' }],
          plaintext: true,
          isUnary: true,
          isServerStream: false,
          isClientStream: false,
          isBidiStream: false,
          
          // SOAP data
          wsdlUrl: 'https://example.com/service?wsdl',
          soapAction: 'http://example.com/GetTest',
          operation: 'GetTest',
          soapBody: '<soap:Envelope></soap:Envelope>',
          
          // WebSocket data
          protocol: 'websocket',
          message: '{"type": "test"}',
          event: 'message',
          topic: 'test/topic',
          isSubscribe: true,
          isPublish: false,
          
          // Search/swagger data
          name: 'Test',
          description: 'Test description',
          tags: ['tag1', 'tag2'],
          statusCode: 200,
          statusText: 'OK',
          durationMs: 100,
          requestUrl: 'https://api.example.com/test',
          requestMethod: 'GET',
          contentType: 'application/json',
          modelsDiagram: '',
          mermaidDiagram: ''
        }
        
        // This should not throw
        const result = template(sampleData)
        expect(typeof result).toBe('string')
      })
    }
  })
})
