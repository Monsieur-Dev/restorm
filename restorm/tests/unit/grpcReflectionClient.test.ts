import { describe, it, expect } from 'vitest'
import * as protoLoader from '@grpc/proto-loader'
import {
  peekFileDescriptorNameAndDependencies,
  buildFileDescriptorSetBuffer
} from '../../src/main/services/grpc/grpcReflectionClient'
import {
  buildDemoFileDescriptorProto,
  buildDemoFileDescriptorProtoWithDependency,
  buildExtraFileDescriptorProto
} from './fixtures/grpcDescriptorProtoFixture'

const LOAD_OPTIONS: protoLoader.Options = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }

/**
 * These pure functions drive `queryReflection`'s transitive
 * dependency-resolution loop without any network I/O — no live server /
 * docker required, which is what makes them worth unit-testing separately
 * from the live-grpcbin integration test.
 */
describe('peekFileDescriptorNameAndDependencies', () => {
  it('reads name + dependency filenames off a real serialized FileDescriptorProto', () => {
    const { name, dependencies } = peekFileDescriptorNameAndDependencies(buildDemoFileDescriptorProtoWithDependency())
    expect(name).toBe('demo.proto')
    expect(dependencies).toEqual(['extra.proto'])
  })

  it('returns an empty dependency list for a file with none', () => {
    const { name, dependencies } = peekFileDescriptorNameAndDependencies(buildDemoFileDescriptorProto())
    expect(name).toBe('demo.proto')
    expect(dependencies).toEqual([])
  })
})

describe('buildFileDescriptorSetBuffer', () => {
  it('concatenates multiple files into one FileDescriptorSet the real proto-loader can decode', () => {
    const fdSet = buildFileDescriptorSetBuffer([
      buildDemoFileDescriptorProtoWithDependency(),
      buildExtraFileDescriptorProto()
    ])
    const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(fdSet, LOAD_OPTIONS)
    // Both files' types are present — the resolved dependency (`demo.Extra`)
    // sits alongside the service-carrying file's own types.
    expect(Object.keys(pkgDef).sort()).toEqual(['demo.Extra', 'demo.Greeter', 'demo.Req', 'demo.Res'])
  })

  it('round-trips a single file unchanged', () => {
    const single = buildDemoFileDescriptorProto()
    const fdSet = buildFileDescriptorSetBuffer([single])
    const pkgDef = protoLoader.loadFileDescriptorSetFromBuffer(fdSet, LOAD_OPTIONS)
    expect(Object.keys(pkgDef).sort()).toEqual(['demo.Greeter', 'demo.Req', 'demo.Res'])
  })
})
