/**
 * Unit tests for RestClientImportService (VSCode REST Client `.http`/`.rest` import)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { importRestClient } from '../../src/main/services/import/RestClientImportService'
import { importProviders } from '../../src/main/services/import/providers'
import type { EnvironmentFolder, HTTPRequest, FolderItem } from '../../src/shared/types/collections'

const loadFixture = (filename: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'rest-client', filename), 'utf-8')

function isHTTPRequest(item: FolderItem): item is HTTPRequest {
  return 'type' in item && item.type === 'http'
}

describe('RestClientImportService', () => {
  const provider = importProviders.find(p => p.format === 'rest-client')

  describe('canImport', () => {
    it('is registered in the provider registry', () => {
      expect(provider).toBeDefined()
    })

    it('returns false on an empty string', () => {
      expect(provider?.canImport('', undefined)).toBe(false)
    })

    it('returns true for a .http file path regardless of content', () => {
      expect(provider?.canImport('anything', 'requests.http')).toBe(true)
    })

    it('returns true for a .rest file path regardless of content', () => {
      expect(provider?.canImport('anything', 'requests.rest')).toBe(true)
    })

    it('returns true for pasted text starting with an HTTP method line', () => {
      expect(provider?.canImport('GET https://api.example.com/users', undefined)).toBe(true)
      expect(provider?.canImport('POST https://api.example.com/users', undefined)).toBe(true)
    })

    it('returns false for JSON content', () => {
      expect(provider?.canImport('{ "openapi": "3.0.0" }', undefined)).toBe(false)
    })

    it('returns false for YAML content', () => {
      expect(provider?.canImport('openapi: 3.0.0\ninfo:\n  title: Petstore', undefined)).toBe(false)
    })
  })

  describe('importRestClient', () => {
    const fixture = loadFixture('sample.http')

    it('splits on ### separators — each block becomes one HTTP request', () => {
      const folder = importRestClient(fixture) as EnvironmentFolder
      const requests = folder.items.filter(isHTTPRequest)
      expect(requests).toHaveLength(2)
    })

    it('parses the request line, headers, and blank-line-separated body', () => {
      const folder = importRestClient(fixture) as EnvironmentFolder
      const requests = folder.items.filter(isHTTPRequest)

      const getUsers = requests.find(r => r.method === 'GET')
      expect(getUsers).toBeDefined()
      expect(getUsers?.url).toBe('{{baseUrl}}/users')
      expect(getUsers?.headers.map(h => h.key)).toContain('Authorization')
      expect(getUsers?.body).toBeUndefined()

      const createUser = requests.find(r => r.method === 'POST')
      expect(createUser).toBeDefined()
      expect(createUser?.headers.find(h => h.key === 'Content-Type')?.value.toString()).toBe('application/json')
      expect(createUser?.body?.type).toBe('text')
      expect(createUser?.body?.content).toContain('"name": "Alice"')
    })

    it('maps a named request (# @name) to the request name', () => {
      const folder = importRestClient(fixture) as EnvironmentFolder
      const requests = folder.items.filter(isHTTPRequest)
      const createUser = requests.find(r => r.method === 'POST')
      expect(createUser?.name).toBe('createUser')
    })

    it('falls back to the ### title when there is no # @name', () => {
      const folder = importRestClient(fixture) as EnvironmentFolder
      const requests = folder.items.filter(isHTTPRequest)
      const getUsers = requests.find(r => r.method === 'GET')
      expect(getUsers?.name).toBe('Get users')
    })

    it('maps top-of-file @name = value declarations to folder-level env variables', () => {
      const folder = importRestClient(fixture) as EnvironmentFolder
      expect(folder.environments).toHaveLength(1)
      const variables = folder.environments[0].variables
      expect(variables.find(v => v.key === 'baseUrl')?.value.toString()).toBe('https://api.example.com')
      expect(variables.find(v => v.key === 'token')?.value.toString()).toBe('abc123')
    })

    it('preserves {{var}} templates verbatim (already Handlebars-compatible)', () => {
      const folder = importRestClient(fixture) as EnvironmentFolder
      const requests = folder.items.filter(isHTTPRequest)
      const getUsers = requests.find(r => r.method === 'GET')
      expect(getUsers?.url).toContain('{{baseUrl}}')
      expect(getUsers?.headers.find(h => h.key === 'Authorization')?.value.toString()).toContain('{{token}}')
    })

    it('is idempotent — re-importing the same content yields the same request ids', () => {
      const first = importRestClient(fixture) as EnvironmentFolder
      const second = importRestClient(fixture) as EnvironmentFolder
      const firstIds = first.items.filter(isHTTPRequest).map(r => r.id)
      const secondIds = second.items.filter(isHTTPRequest).map(r => r.id)
      expect(firstIds).toEqual(secondIds)
    })

    it('handles a single request with no ### separator at all', () => {
      const folder = importRestClient('GET https://api.example.com/ping') as EnvironmentFolder
      const requests = folder.items.filter(isHTTPRequest)
      expect(requests).toHaveLength(1)
      expect(requests[0].method).toBe('GET')
      expect(requests[0].url).toBe('https://api.example.com/ping')
    })

    it('creates no environment when the file declares no top-level variables', () => {
      const folder = importRestClient('### Ping\nGET https://api.example.com/ping') as EnvironmentFolder
      expect(folder.environments).toHaveLength(0)
    })
  })
})
