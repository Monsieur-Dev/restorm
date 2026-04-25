/**
 * Unit tests for `ODataImportService` — parses the live petstore
 * `$metadata` fixture and asserts the shape of the generated
 * EnvironmentFolder.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { importOData } from '../../src/main/services/import/ODataImportService'
import { ODataRequest } from '../../src/shared/models'
import type { Folder } from '../../src/shared/types/collections'

const fixturePath = join(__dirname, 'odata-petstore-v4-metadata.xml')
const fixture = readFileSync(fixturePath, 'utf-8')

function expectPresent<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be present`)
  }
  return value
}

function findSubFolder(root: ReturnType<typeof importOData>, name: string): Folder {
  const folder = (root.items as Folder[]).find((f): f is Folder => 'items' in f && f.name === name)
  return expectPresent(folder, `folder "${name}"`)
}

describe('importOData (v4 EDMX)', () => {
  it('returns an EnvironmentFolder with odata-tagged import origin', () => {
    const root = importOData(fixture, { sourceUrl: 'http://localhost:5100/odata/$metadata' })
    expect(root.folderType).toBe('environment')
    expect(root.importSource).toBe('odata')
    expect(root.apiDocumentation?.sourceType).toBe('odata')
    expect(root.apiDocumentation?.sourceUrl).toBe('http://localhost:5100/odata/$metadata')
  })

  it('creates a localhost environment with baseUrl derived from the service root', () => {
    const root = importOData(fixture, { sourceUrl: 'http://localhost:5100/odata/$metadata' })
    expect(root.environments).toHaveLength(1)
    const env = expectPresent(root.environments[0], 'environment[0]')
    expect(env.name).toBe('localhost')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('http://localhost:5100/odata')
  })

  it('honours a caller-supplied baseUrl override', () => {
    const root = importOData(fixture, { baseUrl: 'https://prod/odata' })
    const env = expectPresent(root.environments[0], 'environment[0]')
    const baseUrl = env.variables.find((v) => v.key === 'baseUrl')
    expect(baseUrl?.value.toString()).toBe('https://prod/odata')
  })

  it('generates one sub-folder per entity set with five CRUD requests', () => {
    const root = importOData(fixture)
    const entitySetFolders = (root.items as Folder[]).filter((f): f is Folder =>
      'items' in f && ['Pets', 'Categories', 'Tags', 'Owners'].includes(f.name)
    )
    expect(entitySetFolders.map((f) => f.name).sort()).toEqual(
      ['Categories', 'Owners', 'Pets', 'Tags']
    )
    for (const folder of entitySetFolders) {
      expect(folder.items).toHaveLength(5)
      expect(folder.items.every((r) => r instanceof ODataRequest)).toBe(true)
    }
  })

  it('wires v4 + entity-set operationKind on entity-set CRUD requests', () => {
    const root = importOData(fixture)
    const pets = findSubFolder(root, 'Pets')
    const list = expectPresent(pets.items[0] as ODataRequest | undefined, 'pets.items[0]')
    expect(list.type).toBe('odata')
    expect(list.odataVersion).toBe('v4')
    expect(list.operationKind).toBe('entity-set')
    expect(list.url).toBe('{{baseUrl}}/Pets')
    expect(list.name).toBe('List Pets')
  })

  it('fills entitySetProperties and navigationProperties from the bound entity type', () => {
    const root = importOData(fixture)
    const pets = findSubFolder(root, 'Pets')
    const list = expectPresent(pets.items[0] as ODataRequest | undefined, 'pets.items[0]')
    // Pet entity carries at least Id + Name as structural properties
    // and Category + Tags + Owner as navigation properties in the
    // fixture — the exact list is frozen to the fixture's EDMX.
    expect(list.entitySetProperties).toBeDefined()
    expect(list.entitySetProperties).toContain('Id')
    expect(list.entitySetProperties).toContain('Name')
    expect(list.navigationProperties).toBeDefined()
    expect(list.navigationProperties).toContain('Category')
    expect(list.navigationProperties).toContain('Tags')
  })

  it('builds key-scoped URLs for GET-by-key / PATCH / DELETE', () => {
    const root = importOData(fixture)
    const pets = findSubFolder(root, 'Pets')
    const byKey = expectPresent(pets.items[1] as ODataRequest | undefined, 'pets.items[1]')
    const patch = expectPresent(pets.items[3] as ODataRequest | undefined, 'pets.items[3]')
    const del = expectPresent(pets.items[4] as ODataRequest | undefined, 'pets.items[4]')
    expect(byKey.url).toBe('{{baseUrl}}/Pets({{id}})')
    expect(patch.url).toBe('{{baseUrl}}/Pets({{id}})')
    expect(del.url).toBe('{{baseUrl}}/Pets({{id}})')
  })

  it('creates an Actions folder with the bound AdoptPet POST request', () => {
    const root = importOData(fixture)
    const actions = findSubFolder(root, 'Actions')
    expect(actions.items).toHaveLength(1)
    const adopt = expectPresent(actions.items[0] as ODataRequest | undefined, 'actions.items[0]')
    expect(adopt.operationKind).toBe('action')
    expect(adopt.name).toBe('Action AdoptPet (bound)')
    // AdoptPet is declared in the `Default` schema namespace in the
    // petstore fixture, so its qualified name is `Default.AdoptPet`.
    expect(adopt.url).toContain('/Default.AdoptPet')
    expect(adopt.actionBody).toContain('"OwnerId"')
  })

  it('creates a Functions folder with an unbound GetAvailablePets GET request', () => {
    const root = importOData(fixture)
    const functions = findSubFolder(root, 'Functions')
    expect(functions.items).toHaveLength(1)
    const fn = expectPresent(functions.items[0] as ODataRequest | undefined, 'functions.items[0]')
    expect(fn.operationKind).toBe('function')
    expect(fn.name).toBe('Function GetAvailablePets')
    expect(fn.url).toContain(`(category='{{category}}')`)
  })

  it('extracts entity types, enums, and operations into ApiDocumentation models', () => {
    const root = importOData(fixture)
    const doc = expectPresent(root.apiDocumentation, 'apiDocumentation')
    expect(doc.models['OData.PetStore.Models.Pet']?.type).toBe('object')
    expect(doc.models['OData.PetStore.Models.PetStatus']?.type).toBe('enum')
    expect(doc.models['OData.PetStore.Models.PetStatus']?.enum).toEqual(['Available', 'Pending', 'Sold'])
    expect(doc.operations.some((op) => op.method === 'POST' && op.path.includes('AdoptPet'))).toBe(true)
    expect(doc.operations.some((op) => op.method === 'GET' && op.path.includes('GetAvailablePets'))).toBe(true)
  })

  it('defaults the service root when neither baseUrl nor sourceUrl is given', () => {
    const root = importOData(fixture)
    const env = expectPresent(root.environments[0], 'environment[0]')
    const base = env.variables.find((v) => v.key === 'baseUrl')
    expect(base?.value.toString()).toBe('http://localhost/odata')
  })
})
