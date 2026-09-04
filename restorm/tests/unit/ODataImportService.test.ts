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
    expect((doc.models['OData.PetStore.Models.Pet']?.properties.length ?? 0) > 0).toBe(true)
    // Enums follow the shared enum shape: empty `properties`, values in
    // `enumValues` — the form the $filter autocomplete and doc viewer read.
    expect(doc.models['OData.PetStore.Models.PetStatus']?.properties).toEqual([])
    expect(doc.models['OData.PetStore.Models.PetStatus']?.enumValues).toEqual(['Available', 'Pending', 'Sold'])
    // Operations carry their route in `match`, like every other importer.
    expect(doc.operations.some((op) => op.match.method === 'POST' && op.match.urlPattern.includes('AdoptPet'))).toBe(true)
    expect(doc.operations.some((op) => op.match.method === 'GET' && op.match.urlPattern.includes('GetAvailablePets'))).toBe(true)
  })

  it('sets entityTypeRef to the bound entity type on entity-set requests', () => {
    const root = importOData(fixture)
    const pets = findSubFolder(root, 'Pets')
    const list = expectPresent(pets.items[0] as ODataRequest | undefined, 'pets.items[0]')
    expect(list.entityTypeRef).toBe('OData.PetStore.Models.Pet')
    const categories = findSubFolder(root, 'Categories')
    const catList = expectPresent(categories.items[0] as ODataRequest | undefined, 'categories.items[0]')
    expect(catList.entityTypeRef).toBe('OData.PetStore.Models.Category')
  })

  it('round-trips entityTypeRef through toPlainObject / fromPlain', () => {
    const root = importOData(fixture)
    const pets = findSubFolder(root, 'Pets')
    const list = expectPresent(pets.items[0] as ODataRequest | undefined, 'pets.items[0]')
    const plain = list.toPlainObject()
    expect(plain.entityTypeRef).toBe('OData.PetStore.Models.Pet')
    const restored = ODataRequest.fromPlain(plain as Parameters<typeof ODataRequest.fromPlain>[0])
    expect(restored.entityTypeRef).toBe('OData.PetStore.Models.Pet')
  })

  it('links an enum-typed property to its enum model via targetModelRef', () => {
    const root = importOData(fixture)
    const doc = expectPresent(root.apiDocumentation, 'apiDocumentation')
    const pet = expectPresent(doc.models['OData.PetStore.Models.Pet'], 'Pet model')
    const status = expectPresent(
      pet.properties.find((p) => p.name === 'Status'),
      'Pet.Status property'
    )
    expect(status.targetModelRef).toBe('OData.PetStore.Models.PetStatus')
    // A primitive property carries no targetModelRef.
    const name = expectPresent(pet.properties.find((p) => p.name === 'Name'), 'Pet.Name property')
    expect(name.targetModelRef).toBeUndefined()
  })

  it('defaults the service root when neither baseUrl nor sourceUrl is given', () => {
    const root = importOData(fixture)
    const env = expectPresent(root.environments[0], 'environment[0]')
    const base = env.variables.find((v) => v.key === 'baseUrl')
    expect(base?.value.toString()).toBe('http://localhost/odata')
  })
})

const v2Fixture = readFileSync(join(__dirname, 'fixtures/odata/v2-metadata.xml'), 'utf-8')
const v3Fixture = readFileSync(join(__dirname, 'fixtures/odata/v3-metadata.xml'), 'utf-8')
const jsonCsdlFixture = readFileSync(join(__dirname, 'fixtures/odata/v4-csdl.json'), 'utf-8')

function firstEntitySetRequests(root: ReturnType<typeof importOData>, setName: string): ODataRequest[] {
  const folder = findSubFolder(root, setName)
  return folder.items.filter((i): i is ODataRequest => i instanceof ODataRequest)
}

describe('importOData (v2 EDMX)', () => {
  it('detects v2 from the edmx Version + DataServiceVersion and tags the root', () => {
    const root = importOData(v2Fixture)
    expect(root.tags).toContain('odata:v2')
  })

  it('tags every generated request with odataVersion v2', () => {
    const root = importOData(v2Fixture)
    const reqs = firstEntitySetRequests(root, 'Products')
    expect(reqs.length).toBe(5)
    expect(reqs.every((r) => r.odataVersion === 'v2')).toBe(true)
  })

  it('parses entity sets, keys and properties from the v2 CSDL', () => {
    const root = importOData(v2Fixture)
    expect(findSubFolder(root, 'Products')).toBeDefined()
    expect(findSubFolder(root, 'Categories')).toBeDefined()
    const getByKey = firstEntitySetRequests(root, 'Products').find((r) => r.name.startsWith('Get'))
    // Key is `ID` → the by-key URL inlines a lower-cased {{id}} placeholder.
    expect(expectPresent(getByKey, 'GET-by-key').url).toContain('({{id}})')
  })

  it('imports a v2 <FunctionImport> into the Functions folder', () => {
    const root = importOData(v2Fixture)
    const functions = findSubFolder(root, 'Functions')
    const names = functions.items
      .filter((i): i is ODataRequest => i instanceof ODataRequest)
      .map((r) => r.name)
    expect(names.some((n) => n.includes('GetProductsByRating'))).toBe(true)
  })
})

describe('importOData (v3 EDMX)', () => {
  it('detects v3 and tags the root + requests', () => {
    const root = importOData(v3Fixture)
    expect(root.tags).toContain('odata:v3')
    const reqs = firstEntitySetRequests(root, 'Suppliers')
    expect(reqs.every((r) => r.odataVersion === 'v3')).toBe(true)
  })

  it('routes a POST <FunctionImport> into the Actions folder', () => {
    const root = importOData(v3Fixture)
    const actions = findSubFolder(root, 'Actions')
    const names = actions.items
      .filter((i): i is ODataRequest => i instanceof ODataRequest)
      .map((r) => r.name)
    expect(names.some((n) => n.includes('DiscountProducts'))).toBe(true)
  })
})

describe('importOData (v4 JSON-CSDL)', () => {
  it('parses a JSON-CSDL document into v4-tagged entity-set folders', () => {
    const root = importOData(jsonCsdlFixture)
    expect(root.tags).toContain('odata:v4')
    expect(findSubFolder(root, 'Products')).toBeDefined()
    expect(findSubFolder(root, 'Categories')).toBeDefined()
    const reqs = firstEntitySetRequests(root, 'Products')
    expect(reqs.length).toBe(5)
    expect(reqs.every((r) => r.odataVersion === 'v4')).toBe(true)
  })

  it('extracts the enum type into ApiDocumentation models', () => {
    const root = importOData(jsonCsdlFixture)
    const doc = expectPresent(root.apiDocumentation, 'apiDocumentation')
    expect(doc.models['ODataDemo.Color']?.properties).toEqual([])
    expect(doc.models['ODataDemo.Color']?.enumValues).toEqual(['Red', 'Green', 'Blue'])
  })

  it('imports a bound action and an unbound function', () => {
    const root = importOData(jsonCsdlFixture)
    const actionNames = findSubFolder(root, 'Actions').items
      .filter((i): i is ODataRequest => i instanceof ODataRequest)
      .map((r) => r.name)
    const functionNames = findSubFolder(root, 'Functions').items
      .filter((i): i is ODataRequest => i instanceof ODataRequest)
      .map((r) => r.name)
    expect(actionNames.some((n) => n.includes('Discount'))).toBe(true)
    expect(functionNames.some((n) => n.includes('TopProducts'))).toBe(true)
  })

  it('strips the binding parameter from a bound action body', () => {
    const root = importOData(jsonCsdlFixture)
    const action = findSubFolder(root, 'Actions').items
      .filter((i): i is ODataRequest => i instanceof ODataRequest)
      .find((r) => r.name.includes('Discount'))
    const actionBody: string = expectPresent(action, 'Discount action').actionBody ?? '{}'
    const body = JSON.parse(actionBody) as Record<string, unknown>
    // `product` is the binding parameter and must not appear; `percent` does.
    expect(body).toHaveProperty('percent')
    expect(body).not.toHaveProperty('product')
  })

  it('throws a clean error on malformed JSON-CSDL', () => {
    expect(() => importOData('{ not valid json')).toThrow(/JSON-CSDL|JSON/)
  })
})

describe('importOData — v4.01 CSDL detection', () => {
  it('tags the root and requests as v4.01 when Edmx Version="4.01"', () => {
    const v401Csdl = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.01" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Demo" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Pet">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Pets" EntityType="Demo.Pet"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
    const root = importOData(v401Csdl)
    expect(root.tags).toContain('odata:v4.01')
    const petsFolder = root.items.find((i): i is Folder => 'items' in i && i.name === 'Pets') as Folder | undefined
    expect(petsFolder).toBeDefined()
    const reqs = (petsFolder?.items ?? []).filter((i): i is ODataRequest => i instanceof ODataRequest)
    expect(reqs.length).toBeGreaterThan(0)
    expect(reqs.every((r) => r.odataVersion === 'v4.01')).toBe(true)
  })
})
