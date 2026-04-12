import { describe, it, expect } from 'vitest'
import { grpcToApiDocumentation, type ParsedProtoData } from '../../../../src/main/services/import/transformers/grpcToApiDocumentation'

const parsed: ParsedProtoData = {
  package: 'petstore.v1',
  services: [
    {
      name: 'PetService',
      comment: 'Manages pets',
      methods: [
        { name: 'GetPet', inputType: 'GetPetRequest', outputType: 'Pet', clientStreaming: false, serverStreaming: false, comment: 'Fetch a pet by id' },
        { name: 'ListPets', inputType: 'ListPetsRequest', outputType: 'Pet', clientStreaming: false, serverStreaming: true },
        { name: 'UpdatePets', inputType: 'Pet', outputType: 'UpdateResult', clientStreaming: true, serverStreaming: false },
        { name: 'Chat', inputType: 'ChatMsg', outputType: 'ChatMsg', clientStreaming: true, serverStreaming: true }
      ]
    }
  ],
  messages: [
    { name: 'Pet', fields: [
      { name: 'id', type: 'int64', number: 1, repeated: false },
      { name: 'name', type: 'string', number: 2, repeated: false },
      { name: 'tags', type: 'string', number: 3, repeated: true }
    ] },
    { name: 'GetPetRequest', fields: [{ name: 'id', type: 'int64', number: 1, repeated: false }] },
    { name: 'ListPetsRequest', fields: [] },
    { name: 'UpdateResult', fields: [{ name: 'ok', type: 'bool', number: 1, repeated: false }] },
    { name: 'ChatMsg', fields: [{ name: 'text', type: 'string', number: 1, repeated: false }] }
  ]
}

describe('grpcToApiDocumentation', () => {
  it('uses package name as title and fills description', () => {
    const doc = grpcToApiDocumentation(parsed, { baseUrl: 'https://grpc.example.com' })
    expect(doc.sourceType).toBe('grpc')
    expect(doc.api.title).toBe('petstore.v1')
    expect(doc.api.description).toBe('gRPC API')
    expect(doc.server?.host).toBe('https://grpc.example.com')
  })

  it('maps messages into models, tagging repeated fields', () => {
    const doc = grpcToApiDocumentation(parsed)
    const pet = doc.models.Pet
    expect(pet?.properties).toEqual([
      { name: 'id', type: 'int64', required: false },
      { name: 'name', type: 'string', required: false },
      { name: 'tags', type: 'repeated string', required: false }
    ])
  })

  it('creates a group per service with its comment', () => {
    const doc = grpcToApiDocumentation(parsed)
    expect(doc.groups.PetService).toEqual({ name: 'PetService', description: 'Manages pets' })
  })

  it('infers unary / server-stream / client-stream / bidi call types', () => {
    const doc = grpcToApiDocumentation(parsed)
    const byName = Object.fromEntries(doc.operations.map((op) => [op.operationId, op]))
    expect(byName.GetPet?.extra).toEqual({ callType: 'unary' })
    expect(byName.ListPets?.extra).toEqual({ callType: 'server-stream' })
    expect(byName.UpdatePets?.extra).toEqual({ callType: 'client-stream' })
    expect(byName.Chat?.extra).toEqual({ callType: 'bidirectional-stream' })
  })

  it('qualifies serviceName with package and records referenced models', () => {
    const doc = grpcToApiDocumentation(parsed, { baseUrl: 'https://grpc.example.com' })
    const get = doc.operations.find((op) => op.operationId === 'GetPet')
    expect(get?.match).toEqual({
      urlPattern: 'https://grpc.example.com',
      operationName: 'GetPet',
      serviceName: 'petstore.v1.PetService'
    })
    expect(get?.referencedModels).toEqual(['GetPetRequest', 'Pet'])
  })

  it('falls back to options.name when package is empty', () => {
    const noPackage: ParsedProtoData = { ...parsed, package: '' }
    const doc = grpcToApiDocumentation(noPackage, { name: 'MyApi' })
    expect(doc.api.title).toBe('MyApi')
    const get = doc.operations.find((op) => op.operationId === 'GetPet')
    expect(get?.match.serviceName).toBe('PetService')
  })

  it('echoes sourceUrl when provided', () => {
    const doc = grpcToApiDocumentation(parsed, { sourceUrl: 'https://example.com/pet.proto' })
    expect(doc.sourceUrl).toBe('https://example.com/pet.proto')
  })
})
