// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertValidProtoPath } from './grpcProtoLoader'

let dir: string
let protoFile: string
let txtFile: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'proto-validate-'))
  protoFile = join(dir, 'svc.proto')
  txtFile = join(dir, 'notes.txt')
  writeFileSync(protoFile, 'syntax = "proto3";', 'utf8')
  writeFileSync(txtFile, 'hello', 'utf8')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('assertValidProtoPath', () => {
  it('accepts an absolute path to an existing .proto file', () => {
    expect(assertValidProtoPath(protoFile)).toBe(protoFile)
  })

  it('rejects a relative path', () => {
    expect(() => assertValidProtoPath('svc.proto')).toThrow(/absolute/)
  })

  it('rejects a non-.proto target (arbitrary file read)', () => {
    expect(() => assertValidProtoPath(txtFile)).toThrow(/\.proto/)
  })

  it('rejects a missing file', () => {
    expect(() => assertValidProtoPath(join(dir, 'missing.proto'))).toThrow(/not found/)
  })

  it('normalises a traversal segment and still validates the real target', () => {
    const traversed = join(dir, 'sub', '..', 'svc.proto')
    expect(assertValidProtoPath(traversed)).toBe(protoFile)
  })
})
