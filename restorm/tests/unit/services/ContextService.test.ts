import { describe, it, expect, vi } from 'vitest';

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  },
  app: { isPackaged: false }
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

// ContextService imports `logger` + `eventBusService` from
// `electron-core-ui/main`. The real module pulls in winston, which
// reads `app.isPackaged` at construction. Stub the module surface
// the service uses so the import doesn't blow up in vitest.
vi.mock('electron-core-ui/main', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  eventBusService: {
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  },
  createPubSub: vi.fn(() => ({ subscribe: vi.fn(() => { return () => undefined }), publish: vi.fn() })),
  serializeWithDecorators: vi.fn((value: unknown) => value)
}));

// Import after mocking
import { contextService } from '../../../src/main/services/ContextService';

describe('ContextService', () => {
  // Access the private method via any cast for testing
  const service = contextService as unknown as { 
    transformValue: (value: string, context: Record<string, string>) => string 
  };

  describe('Handlebars transformations', () => {
    it('should transform variables in URL using environment variables', () => {

      const context = {
        baseUrl: 'https://api.example.com',
        apiKey: 'secret-key-123'
      };

      const result = service.transformValue('{{baseUrl}}/users?key={{apiKey}}', context);
      
      expect(result).toBe('https://api.example.com/users?key=secret-key-123');
    });

    it('should transform path params in URL', () => {
      const context = {
        baseUrl: 'https://api.example.com',
        userId: '12345'
      };

      const result = service.transformValue('{{baseUrl}}/users/{{userId}}', context);
      
      expect(result).toBe('https://api.example.com/users/12345');
    });

    it('should return original value when no variables present', () => {
      const context = { baseUrl: 'https://api.example.com' };

      const result = service.transformValue('https://static-url.com/path', context);
      
      expect(result).toBe('https://static-url.com/path');
    });

    it('should return original value when variable not found in context', () => {
      const context = { baseUrl: 'https://api.example.com' };

      // {{unknown}} should remain empty since it's not in context
      const result = service.transformValue('{{baseUrl}}/{{unknown}}', context);
      
      expect(result).toBe('https://api.example.com/');
    });

    it('should handle nested template syntax', () => {
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
      const context = {
        baseUrl: 'https://api.example.com'
      };

      const result = service.transformValue('{{baseUrl}}/users', context);
      
      // CRITICAL: This should NEVER be empty when context has the variable
      expect(result).not.toBe('');
      expect(result).toBe('https://api.example.com/users');
    });

    it('should transform multiple occurrences of same variable', () => {
      const context = { id: '42' };

      const result = service.transformValue('/items/{{id}}/details/{{id}}', context);

      expect(result).toBe('/items/42/details/42');
    });
  });

  describe('setAvailableEnvironments', () => {
    it('persists the env list onto the registered request context', () => {
      const id = 'auth-1'
      contextService.registerRequest(id, null, { id, headers: [], params: [], pathParams: [] })
      contextService.setAvailableEnvironments(id, ['env-a', 'env-b'])
      const ctx = contextService.getRequestContext(id)
      expect(ctx?.availableEnvironmentIds).toEqual(['env-a', 'env-b'])
      contextService.unregisterRequest(id)
    })

    it('is a no-op when the request is not registered', () => {
      // Documenting the contract: a stale push for an unregistered
      // request silently drops on the floor instead of resurrecting
      // an entry. The renderer can race tab-close vs. env-change.
      expect(() => { contextService.setAvailableEnvironments('ghost', ['env-a']) }).not.toThrow()
      expect(contextService.getRequestContext('ghost')).toBeUndefined()
    })

    it('overwrites the previous list on each call', () => {
      const id = 'overwrite-1'
      contextService.registerRequest(id, null, { id, headers: [], params: [], pathParams: [] })
      contextService.setAvailableEnvironments(id, ['env-a'])
      contextService.setAvailableEnvironments(id, ['env-b', 'env-c'])
      expect(contextService.getRequestContext(id)?.availableEnvironmentIds).toEqual(['env-b', 'env-c'])
      contextService.unregisterRequest(id)
    })
  });
});
