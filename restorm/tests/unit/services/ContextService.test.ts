import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}));

// Mock Winston logger
vi.mock('../../../src/main/services/LoggerService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Import after mocking
import { ContextService } from '../../../src/main/services/ContextService';

describe('ContextService', () => {
  let contextService: ContextService;

  beforeEach(() => {
    contextService = new ContextService();
  });

  describe('Handlebars transformations', () => {
    it('should transform variables in URL using environment variables', () => {
      // Access the private method via any cast for testing
      const service = contextService as unknown as { 
        transformValue: (value: string, context: Record<string, string>) => string 
      };

      const context = {
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key-123'
      };

      const result = service.transformValue('{{baseUrl}}/users?key={{apiKey}}', context);
      
      expect(result).toBe('https://api.example.com/users?key=secret-key-123');
    });

    it('should transform path params in URL', () => {
      const service = contextService as unknown as { 
        transformValue: (value: string, context: Record<string, string>) => string 
      };

      const context = {
        baseUrl: 'https://api.example.com',
        userId: '12345'
      };

      const result = service.transformValue('{{baseUrl}}/users/{{userId}}', context);
      
      expect(result).toBe('https://api.example.com/users/12345');
    });

    it('should return original value when no variables present', () => {
      const service = contextService as unknown as { 
        transformValue: (value: string, context: Record<string, string>) => string 
      };

      const context = { baseUrl: 'https://api.example.com' };

      const result = service.transformValue('https://static-url.com/path', context);
      
      expect(result).toBe('https://static-url.com/path');
    });

    it('should return original value when variable not found in context', () => {
      const service = contextService as unknown as { 
        transformValue: (value: string, context: Record<string, string>) => string 
      };

      const context = { baseUrl: 'https://api.example.com' };

      // {{unknown}} should remain empty since it's not in context
      const result = service.transformValue('{{baseUrl}}/{{unknown}}', context);
      
      expect(result).toBe('https://api.example.com/');
    });

    it('should handle nested template syntax', () => {
      const service = contextService as unknown as { 
        transformValue: (value: string, context: Record<string, string>) => string 
      };

      const context = {
        protocol: 'https',
        host: 'api.example.com',
        version: 'v1'
      };

      const result = service.transformValue('{{protocol}}://{{host}}/{{version}}/users', context);
      
      expect(result).toBe('https://api.example.com/v1/users');
    });

    it('should NOT return empty string for valid templates (regression test)', () => {
      // This test will fail if someone adds `return '';` at the beginning of transformValue
      const service = contextService as unknown as { 
        transformValue: (value: string, context: Record<string, string>) => string 
      };

      const context = {
        baseUrl: 'https://api.example.com'
      };

      const result = service.transformValue('{{baseUrl}}/users', context);
      
      // CRITICAL: This should NEVER be empty when context has the variable
      expect(result).not.toBe('');
      expect(result).toBe('https://api.example.com/users');
    });

    it('should transform multiple occurrences of same variable', () => {
      const service = contextService as unknown as { 
        transformValue: (value: string, context: Record<string, string>) => string 
      };

      const context = { id: '42' };

      const result = service.transformValue('/items/{{id}}/details/{{id}}', context);
      
      expect(result).toBe('/items/42/details/42');
    });
  });
});

