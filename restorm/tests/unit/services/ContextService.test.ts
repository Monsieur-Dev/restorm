import { describe, it, expect, vi } from 'vitest';

// Mock electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  },
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
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
import { collectionStore } from '../../../src/main/services/CollectionStore';
import { KeyValue } from '../../../src/shared/models';
import { CustomListValue, CustomListMultiValue } from '../../../src/shared/types/collections';
import type { EnvironmentFolder, HTTPRequest } from '../../../src/shared/types/collections';

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

  describe('CustomListValue resolution', () => {
    const reqId = 'req-customlist'
    const listId = 'couleur-list'

    function seed(entries: { id: string; label: string; value: string }[]): void {
      const request = {
        type: 'http', id: reqId, name: 'r', method: 'GET', url: '{{baseUrl}}/x',
        headers: [], params: [], pathParams: [], tags: []
      } as unknown as HTTPRequest
      const folder = {
        folderType: 'environment', fileFormatVersion: 1, id: 'env-folder', name: 'F',
        tags: [], configuration: {}, environments: [], items: [request],
        customValueLists: [{ id: listId, name: 'Couleur', entries }]
      } as unknown as EnvironmentFolder
      collectionStore.setCollections([folder])
      contextService.registerRequest(reqId, null, { id: reqId, headers: [], params: [], pathParams: [] })
    }

    it('substitutes the entry value for the selected label', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000' }, { id: 'e2', label: 'Vert', value: '00FF00' }])
      const kv = new KeyValue({ key: 'color', value: new CustomListValue(listId, 'Rouge') })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('FF0000')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })

    it('reflects an edited entry value on the next resolution (no snapshot)', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000' }])
      const kv = new KeyValue({ key: 'color', value: new CustomListValue(listId, 'Rouge') })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('FF0000')
      // Edit the list entry value, then resolve again.
      collectionStore.setCollections([{
        folderType: 'environment', fileFormatVersion: 1, id: 'env-folder', name: 'F',
        tags: [], configuration: {}, environments: [],
        items: [{ type: 'http', id: reqId, name: 'r', method: 'GET', url: '{{baseUrl}}/x', headers: [], params: [], pathParams: [], tags: [] }],
        customValueLists: [{ id: listId, name: 'Couleur', entries: [{ id: 'e1', label: 'Rouge', value: 'FF0001' }] }]
      } as unknown as EnvironmentFolder])
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('FF0001')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })

    it('resolves to empty when the list or entry is missing (no label fallback)', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000' }])
      const kv = new KeyValue({ key: 'color', value: new CustomListValue(listId, 'Inconnu') })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })

    it('treats a disabled entry as unavailable — resolves to empty (no label fallback)', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000', enabled: false }])
      const kv = new KeyValue({ key: 'color', value: new CustomListValue(listId, 'Rouge') })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })
  });

  describe('CustomListMultiValue resolution', () => {
    const reqId = 'req-customlistmulti'
    const listId = 'couleur-list'

    function seed(entries: { id: string; label: string; value: string; enabled?: boolean }[]): void {
      const request = {
        type: 'http', id: reqId, name: 'r', method: 'GET', url: '{{baseUrl}}/x',
        headers: [], params: [], pathParams: [], tags: []
      } as unknown as HTTPRequest
      const folder = {
        folderType: 'environment', fileFormatVersion: 1, id: 'env-folder', name: 'F',
        tags: [], configuration: {}, environments: [], items: [request],
        customValueLists: [{ id: listId, name: 'Couleur', entries }]
      } as unknown as EnvironmentFolder
      collectionStore.setCollections([folder])
      contextService.registerRequest(reqId, null, { id: reqId, headers: [], params: [], pathParams: [] })
    }

    it('substitutes each selected label with its value (comma-joined)', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000' }, { id: 'e2', label: 'Vert', value: '00FF00' }])
      const kv = new KeyValue({ key: 'colors', value: new CustomListMultiValue(listId, ['Rouge', 'Vert']) })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('FF0000,00FF00')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })

    it('drops a disabled label from the resolved values', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000' }, { id: 'e2', label: 'Vert', value: '00FF00', enabled: false }])
      const kv = new KeyValue({ key: 'colors', value: new CustomListMultiValue(listId, ['Rouge', 'Vert']) })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('FF0000')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })

    it('drops an unknown label', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000' }])
      const kv = new KeyValue({ key: 'colors', value: new CustomListMultiValue(listId, ['Rouge', 'Inconnu']) })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('FF0000')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })

    it('resolves to empty when the whole list is missing (no label fallback)', () => {
      seed([{ id: 'e1', label: 'Rouge', value: 'FF0000' }])
      const kv = new KeyValue({ key: 'colors', value: new CustomListMultiValue('ghost-list', ['Rouge', 'Vert']) })
      expect(contextService.resolveKeyValueForRequest(kv, reqId)).toBe('')
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    })
  });

  describe('environment variable custom-list resolution', () => {
    const envId = 'env-cl'
    const listId = 'colors-list'

    interface EnvVar { key: string; value: unknown }
    const svc = contextService as unknown as {
      handleEnvironmentCreated: (payload: unknown) => void
    }

    function seedEnv(
      vars: EnvVar[],
      entries: { id: string; label: string; value: string; enabled?: boolean }[]
    ): void {
      const folder = {
        folderType: 'environment', fileFormatVersion: 1, id: 'folder-cl', name: 'F',
        tags: [], configuration: {}, items: [],
        environments: [{ id: envId, name: 'E', variables: [] }],
        customValueLists: [{ id: listId, name: 'Colors', entries }]
      } as unknown as EnvironmentFolder
      collectionStore.setCollections([folder])
      svc.handleEnvironmentCreated({
        id: envId, type: 'environment', parentFolderId: 'folder-cl',
        document: { id: envId, name: 'E', variables: vars }
      })
    }

    function cleanup(): void {
      collectionStore.setCollections([])
    }

    it('resolves a single custom-list env variable to its entry value', () => {
      seedEnv(
        [{ key: 'theme', value: { type: 'customList', listId, label: 'Rouge' } }],
        [{ id: 'e1', label: 'Rouge', value: 'FF0000' }, { id: 'e2', label: 'Vert', value: '00FF00' }]
      )
      expect(contextService.getContext(envId)?.theme).toBe('FF0000')
      cleanup()
    })

    it('resolves a multi custom-list env variable to comma-joined values, dropping disabled', () => {
      seedEnv(
        [{ key: 'themes', value: { type: 'customListMulti', listId, labels: ['Rouge', 'Vert'] } }],
        [{ id: 'e1', label: 'Rouge', value: 'FF0000' }, { id: 'e2', label: 'Vert', value: '00FF00', enabled: false }]
      )
      expect(contextService.getContext(envId)?.themes).toBe('FF0000')
      cleanup()
    })

    it('resolves to empty when the entry is missing (no label fallback)', () => {
      seedEnv(
        [{ key: 'theme', value: { type: 'customList', listId, label: 'Inconnu' } }],
        [{ id: 'e1', label: 'Rouge', value: 'FF0000' }]
      )
      expect(contextService.getContext(envId)?.theme).toBe('')
      cleanup()
    })
  });

  describe('body resolution gated on the Content-Type', () => {
    const reqId = 'req-json-body'

    function seed(variables: Record<string, string>): void {
      contextService.registerRequest(reqId, null, { id: reqId, headers: [], params: [], pathParams: [] })
      contextService.setScenarioVariables(reqId, variables)
    }

    function cleanup(): void {
      contextService.unregisterRequest(reqId)
    }

    it('resolves a tight-brace variable and escapes a string value when the body is JSON', () => {
      seed({ petId: '42', name: 'a"b' })
      const out = contextService.resolveBodyValue(
        '{"id":{{petId}},"name":"{{name}}"}',
        reqId,
        'application/json; charset=utf-8'
      )
      expect(out).toBe('{"id":42,"name":"a\\"b"}')
      expect(JSON.parse(out)).toEqual({ id: 42, name: 'a"b' })
      cleanup()
    })

    it('keeps the raw whole-template substitution for a non-JSON content type', () => {
      seed({ name: 'a"b' })
      // XML / plain text keep today's behaviour: substituted verbatim, no escaping.
      expect(contextService.resolveBodyValue('<n>{{name}}</n>', reqId, 'application/xml')).toBe('<n>a"b</n>')
      // …and a JSON-looking body without a JSON content type still hits the
      // whole-template compile, whose parse error leaves the body untouched.
      expect(contextService.resolveBodyValue('{"id":{{petId}}}', reqId, undefined)).toBe('{"id":{{petId}}}')
      cleanup()
    })

    it('returns the body untouched when the request has no context', () => {
      expect(contextService.resolveBodyValue('{"id":{{petId}}}', 'unknown-request', 'application/json')).toBe(
        '{"id":{{petId}}}'
      )
    })
  });

  describe('JSON body resolution against a scenario variable overlay', () => {
    // The scenario engine dispatches through the same executor as the panel,
    // but its variables come from the per-run `setVariable` overlay rather than
    // the environment. The overlay has to reach the JSON body resolver — and
    // win over an environment variable of the same name.
    const envId = 'env-scenario-body'
    const reqId = 'req-scenario-body'
    const svc = contextService as unknown as {
      handleEnvironmentCreated: (payload: unknown) => void
    }

    function seed(): void {
      const request = {
        type: 'http', id: reqId, name: 'r', method: 'POST', url: '{{baseUrl}}/x',
        headers: [], params: [], pathParams: [], tags: []
      } as unknown as HTTPRequest
      const folder = {
        folderType: 'environment', fileFormatVersion: 1, id: 'folder-scenario-body', name: 'F',
        tags: [], configuration: {}, items: [request],
        environments: [{ id: envId, name: 'E', variables: [] }]
      } as unknown as EnvironmentFolder
      collectionStore.setCollections([folder])
      svc.handleEnvironmentCreated({
        id: envId, type: 'environment', parentFolderId: 'folder-scenario-body',
        document: {
          id: envId,
          name: 'E',
          variables: [
            { key: 'petId', value: { type: 'string', value: '1' } },
            { key: 'petName', value: { type: 'string', value: 'from-env' } }
          ]
        }
      })
      contextService.registerRequest(reqId, envId, { id: reqId, headers: [], params: [], pathParams: [] })
    }

    function cleanup(): void {
      contextService.setScenarioVariables(reqId, undefined)
      contextService.unregisterRequest(reqId)
      collectionStore.setCollections([])
    }

    it('resolves a JSON body from the run overlay, which wins over the environment', () => {
      seed()
      const template = '{"name":"{{petName}}","id":{{petId}}}'
      // Without an overlay the environment supplies the values.
      expect(contextService.resolveBodyValue(template, reqId, 'application/json')).toBe(
        '{"name":"from-env","id":1}'
      )

      contextService.setScenarioVariables(reqId, { petId: '42', petName: 'Rex "the\\dog"' })
      const out = contextService.resolveBodyValue(template, reqId, 'application/json')

      expect(JSON.parse(out)).toEqual({ name: 'Rex "the\\dog"', id: 42 })
      cleanup()
    })
  });
});
