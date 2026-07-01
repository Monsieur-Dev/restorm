/**
 * Unit tests for `ThunderClientImportService` — parses a representative
 * Thunder Client collection export and asserts the shape of the generated
 * EnvironmentFolder, plus the format's auto-detection behaviour.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { detectFormat } from '../../src/main/services/import/ImportManager'
import {
  importThunderClient,
  importThunderClientFromJson
} from '../../src/main/services/import/ThunderClientImportService'
import type { Folder, HTTPRequest, GraphQLRequest, FolderItem } from '../../src/shared/types/collections'

const fixture = readFileSync(
  join(__dirname, 'fixtures/thunder-client/thunder-collection-sample.json'),
  'utf-8'
)

function isFolder(item: FolderItem): item is Folder {
  return 'items' in item
}

function isHTTPRequest(item: FolderItem): item is HTTPRequest {
  return 'type' in item && item.type === 'http'
}

function isGraphQLRequest(item: FolderItem): item is GraphQLRequest {
  return 'type' in item && item.type === 'graphql'
}

function findFolder(items: FolderItem[], name: string): Folder {
  const folder = items.find((item): item is Folder => isFolder(item) && item.name === name)
  if (!folder) throw new Error(`expected folder "${name}" to be present`)
  return folder
}

function findRequest(items: FolderItem[], name: string): HTTPRequest | GraphQLRequest {
  const request = items.find(
    (item): item is HTTPRequest | GraphQLRequest => (isHTTPRequest(item) || isGraphQLRequest(item)) && item.name === name
  )
  if (!request) throw new Error(`expected request "${name}" to be present`)
  return request
}

/** `HTTPRequest.body` is a discriminated union — only the two form-shaped
 * variants carry `fields`. Narrow by `type` before reading them out. */
function bodyFieldKeys(body: HTTPRequest['body']): string[] {
  if (body?.type === 'form-data' || body?.type === 'x-www-form-urlencoded') {
    return body.fields.map((f) => f.key)
  }
  return []
}

describe('ThunderClientImportService', () => {
  describe('canImport (via the registry)', () => {
    it('detects a Thunder Client export', () => {
      expect(detectFormat(fixture)).toBe('thunder-client')
    })

    it('does not misdetect a Postman collection', () => {
      const postmanJson = readFileSync(join(__dirname, 'postman-petstore.json'), 'utf-8')
      expect(detectFormat(postmanJson)).not.toBe('thunder-client')
    })

    it('does not misdetect an Insomnia export', () => {
      const insomniaJson = readFileSync(join(__dirname, 'insomnia-petstore.json'), 'utf-8')
      expect(detectFormat(insomniaJson)).not.toBe('thunder-client')
    })

    it('rejects non-JSON content', () => {
      expect(detectFormat('not json at all')).not.toBe('thunder-client')
    })
  })

  describe('importThunderClientFromJson', () => {
    it('returns an EnvironmentFolder tagged with the thunder-client import origin', () => {
      const root = importThunderClientFromJson(fixture)
      expect(root.folderType).toBe('environment')
      expect(root.importSource).toBe('thunder-client')
      expect(root.name).toBe('Thunder Client Sample')
    })

    it('preserves nested folder hierarchy via containerId', () => {
      const root = importThunderClientFromJson(fixture)
      const pets = findFolder(root.items, 'Pets')
      const admin = findFolder(pets.items, 'Admin')
      expect(findRequest(pets.items, 'List pets')).toBeDefined()
      expect(findRequest(admin.items, 'Upload photo')).toBeDefined()
    })

    it('maps method, url, and headers on a plain HTTP request', () => {
      const root = importThunderClientFromJson(fixture)
      const pets = findFolder(root.items, 'Pets')
      const request = findRequest(pets.items, 'List pets') as HTTPRequest
      expect(request.method).toBe('GET')
      expect(request.url).toBe('{{baseUrl}}/pets')
      expect(request.headers.map(h => h.key)).toContain('Accept')
    })

    it('splits params into query params and path params via isPath', () => {
      const root = importThunderClientFromJson(fixture)
      const pets = findFolder(root.items, 'Pets')
      const request = findRequest(pets.items, 'List pets') as HTTPRequest
      expect(request.params.map(p => p.key)).toEqual(['limit'])
      expect(request.pathParams?.map(p => p.key)).toEqual(['petId'])
    })

    it('maps a json body to a text body', () => {
      const root = importThunderClientFromJson(fixture)
      const pets = findFolder(root.items, 'Pets')
      const request = findRequest(pets.items, 'Create pet') as HTTPRequest
      expect(request.body).toEqual({ type: 'text', content: '{"name": "Rex"}' })
    })

    it('maps a formdata body to a form-data body', () => {
      const root = importThunderClientFromJson(fixture)
      const pets = findFolder(root.items, 'Pets')
      const admin = findFolder(pets.items, 'Admin')
      const request = findRequest(admin.items, 'Upload photo') as HTTPRequest
      expect(request.body?.type).toBe('form-data')
      expect(bodyFieldKeys(request.body)).toEqual(['file', 'caption'])
    })

    it('maps a form-encoded body to an x-www-form-urlencoded body', () => {
      const root = importThunderClientFromJson(fixture)
      const request = findRequest(root.items, 'Login') as HTTPRequest
      expect(request.body?.type).toBe('x-www-form-urlencoded')
      expect(bodyFieldKeys(request.body)).toEqual(['username', 'password'])
    })

    it('maps a graphql body to a GraphQLRequest', () => {
      const root = importThunderClientFromJson(fixture)
      const request = findRequest(root.items, 'Pets GraphQL') as GraphQLRequest
      expect(request.type).toBe('graphql')
      expect(request.operationType).toBe('query')
      expect(request.query).toContain('GetPets')
      expect(request.variables).toBe('{}')
    })

    it('maps a none body to no body at all', () => {
      const root = importThunderClientFromJson(fixture)
      const request = findRequest(root.items, 'Delete pet') as HTTPRequest
      expect(request.body).toBeUndefined()
    })

    it('carries docs into documentation and tests into notes', () => {
      const root = importThunderClientFromJson(fixture)
      const pets = findFolder(root.items, 'Pets')
      const listPets = findRequest(pets.items, 'List pets') as HTTPRequest
      expect(listPets.documentation).toBe('Returns the list of pets.')

      const createPet = findRequest(pets.items, 'Create pet') as HTTPRequest
      expect(createPet.notes).toContain('res-code')
      expect(createPet.notes).toContain('201')
    })

    it('is idempotent: re-parsing the same fixture yields the same ids', () => {
      const first = importThunderClientFromJson(fixture)
      const second = importThunderClientFromJson(fixture)
      expect(second.id).toBe(first.id)
      const firstPets = findFolder(first.items, 'Pets')
      const secondPets = findFolder(second.items, 'Pets')
      expect(secondPets.id).toBe(firstPets.id)
      const firstRequest = findRequest(firstPets.items, 'List pets')
      const secondRequest = findRequest(secondPets.items, 'List pets')
      expect(secondRequest.id).toBe(firstRequest.id)
    })

    it('honours a caller-supplied baseUrl', () => {
      const root = importThunderClientFromJson(fixture, { baseUrl: 'https://api.example.com' })
      const env = root.environments[0]
      expect(env?.variables.find(v => v.key === 'baseUrl')?.value.toString()).toBe('https://api.example.com')
    })

    it('rejects a collection missing folders/requests arrays', () => {
      const invalid = { clientName: 'Thunder Client' } as Parameters<typeof importThunderClient>[0]
      expect(() => importThunderClient(invalid)).toThrow()
    })
  })
})
