import { describe, it, expect } from 'vitest'
import { decomposeForPersistence, cleanseForPersistence } from './decomposer'
import {
  saveUnits,
  fileNaming,
  NonSerialised,
  TreatEmptyAsUndefined
} from '../../decorators'

/**
 * Project config uses TC39 stage-3 decorators at runtime but the
 * library's decorator factories are legacy-shape. Emulate what the
 * legacy transform would emit by applying the decorator to the class
 * prototype at property level.
 */
function applyProperty(cls: object, propertyKey: string, factory: () => PropertyDecorator): void {
  factory()((cls as { prototype: object }).prototype, propertyKey)
}
function applyClass(cls: object, factory: () => ClassDecorator): void {
  factory()(cls as Parameters<ClassDecorator>[0])
}

// ── Fixtures ─────────────────────────────────────────────────────────

class Request {
  id = ''
  name = ''
  url = ''
  note: string | null | undefined = undefined
  runtimeCache?: Map<string, unknown>
}
applyProperty(Request, 'note', TreatEmptyAsUndefined)
applyProperty(Request, 'runtimeCache', NonSerialised)
applyClass(Request, () => fileNaming({
  pattern: '{index} - {name}',
  nameProperty: 'name',
  idProperty: 'id'
}))

class Folder {
  id = ''
  name = ''
  items: Request[] = []
  children: Folder[] = []
}
applyProperty(Folder, 'items', () => saveUnits())
applyProperty(Folder, 'children', () => saveUnits())
applyClass(Folder, () => fileNaming({
  pattern: '{index} - {name}',
  nameProperty: 'name',
  idProperty: 'id'
}))

class Environment {
  id = ''
  name = ''
  baseUrl = ''
  collections: Folder[] = []
}
applyProperty(Environment, 'collections', () => saveUnits())

describe('decomposeForPersistence', () => {
  it('produces the root index file with no separable props leaking in', () => {
    const env = Object.assign(new Environment(), {
      id: 'env',
      name: 'Prod',
      baseUrl: 'https://api.example.com',
      collections: []
    })
    const { rootIndex } = decomposeForPersistence({
      root: env as unknown as Record<string, unknown>,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml'
    })

    expect(rootIndex.absolutePath).toBe('/tmp/proj/index.yaml')
    expect(rootIndex.runtimeId).toBe('env')
    expect(rootIndex.content).toEqual({ id: 'env', name: 'Prod', baseUrl: 'https://api.example.com' })
    expect('collections' in rootIndex.content).toBe(false)
  })

  it('flattens leaf units under the correct path', () => {
    const folder = Object.assign(new Folder(), {
      id: 'f1', name: 'Users', items: [
        Object.assign(new Request(), { id: 'r1', name: 'List', url: '/users' }),
        Object.assign(new Request(), { id: 'r2', name: 'Create', url: '/users' })
      ], children: []
    })
    const env = Object.assign(new Environment(), { id: 'env', name: 'Prod', collections: [folder] })

    const { rootIndex, children } = decomposeForPersistence({
      root: env as unknown as Record<string, unknown>,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml'
    })

    // Root index still written to /tmp/proj/index.yaml, folders nested under it.
    expect(rootIndex.absolutePath).toBe('/tmp/proj/index.yaml')

    const r1 = children.find((c) => c.runtimeId === 'r1')
    const r2 = children.find((c) => c.runtimeId === 'r2')
    const f1 = children.find((c) => c.runtimeId === 'f1')
    expect(r1?.absolutePath).toBe('/tmp/proj/01 - Users/01 - List.yaml')
    expect(r1?.kind).toBe('file')
    expect(r1?.parentId).toBe('f1')
    expect(r2?.absolutePath).toBe('/tmp/proj/01 - Users/02 - Create.yaml')
    expect(f1?.absolutePath).toBe('/tmp/proj/01 - Users/index.yaml')
    expect(f1?.kind).toBe('folder')
    // Root-level folder's parent is the root environment id.
    expect(f1?.parentId).toBe('env')
  })

  it('nests container units recursively with proper parent ids', () => {
    const inner = Object.assign(new Folder(), { id: 'inner', name: 'Admin', items: [], children: [] })
    const outer = Object.assign(new Folder(), { id: 'outer', name: 'Users', items: [], children: [inner] })
    const env = Object.assign(new Environment(), { id: 'env', name: 'Prod', collections: [outer] })

    const { children } = decomposeForPersistence({
      root: env as unknown as Record<string, unknown>,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml'
    })
    const innerEntry = children.find((c) => c.runtimeId === 'inner')
    expect(innerEntry?.absolutePath).toBe('/tmp/proj/01 - Users/01 - Admin/index.yaml')
    expect(innerEntry?.parentId).toBe('outer')
  })

  it('removes @NonSerialised fields from the emitted content', () => {
    const r = Object.assign(new Request(), {
      id: 'r1', name: 'GET', url: '/u', runtimeCache: new Map([['x', 1]])
    })
    const folder = Object.assign(new Folder(), { id: 'f', name: 'Users', items: [r], children: [] })
    const env = Object.assign(new Environment(), { id: 'e', name: 'P', collections: [folder] })

    const { children } = decomposeForPersistence({
      root: env as unknown as Record<string, unknown>,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml'
    })
    const entry = children.find((c) => c.runtimeId === 'r1')
    expect(entry?.content).not.toHaveProperty('runtimeCache')
    expect(entry?.content).toMatchObject({ id: 'r1', name: 'GET', url: '/u' })
  })

  it('collapses @TreatEmptyAsUndefined empty values out of the file content', () => {
    const r1 = Object.assign(new Request(), { id: 'r1', name: 'A', url: '/u', note: '' })
    const r2 = Object.assign(new Request(), { id: 'r2', name: 'B', url: '/u', note: null })
    const r3 = Object.assign(new Request(), { id: 'r3', name: 'C', url: '/u', note: '   ' })
    const folder = Object.assign(new Folder(), { id: 'f', name: 'F', items: [r1, r2, r3], children: [] })
    const env = Object.assign(new Environment(), { id: 'e', name: 'P', collections: [folder] })

    const { children } = decomposeForPersistence({
      root: env as unknown as Record<string, unknown>,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml'
    })
    const e1 = children.find((c) => c.runtimeId === 'r1')?.content
    const e2 = children.find((c) => c.runtimeId === 'r2')?.content
    const e3 = children.find((c) => c.runtimeId === 'r3')?.content
    expect(e1).not.toHaveProperty('note')
    expect(e2).not.toHaveProperty('note')
    // Whitespace-only preserved.
    expect(e3?.['note']).toBe('   ')
  })

  it('uses zero-padded counters based on total sibling count', () => {
    const items = Array.from({ length: 12 }, (_, i) => Object.assign(new Request(), {
      id: `r${i}`,
      name: `R${i}`,
      url: '/'
    }))
    const folder = Object.assign(new Folder(), { id: 'f', name: 'F', items, children: [] })
    const env = Object.assign(new Environment(), { id: 'e', name: 'P', collections: [folder] })

    const { children } = decomposeForPersistence({
      root: env as unknown as Record<string, unknown>,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml'
    })
    const first = children.find((c) => c.runtimeId === 'r0')
    const twelfth = children.find((c) => c.runtimeId === 'r11')
    expect(first?.absolutePath).toBe('/tmp/proj/01 - F/01 - R0.yaml')
    expect(twelfth?.absolutePath).toBe('/tmp/proj/01 - F/12 - R11.yaml')
  })

  it('respects a custom indexFileName', () => {
    const env = Object.assign(new Environment(), { id: 'e', name: 'P', collections: [] })
    const { rootIndex } = decomposeForPersistence({
      root: env as unknown as Record<string, unknown>,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'json',
      extension: 'json',
      indexFileName: '_root'
    })
    expect(rootIndex.absolutePath).toBe('/tmp/proj/_root.json')
  })

  it('uses the supplied classResolver to drive decomposition of POJO trees', () => {
    // Simulates a tree that's been JSON-roundtripped (no class identity).
    const plain = {
      id: 'root',
      name: 'Root',
      collections: [
        { type: 'folder', id: 'f1', name: 'Folder', items: [{ type: 'request', id: 'r1', name: 'R' }], children: [] }
      ]
    }
    const { children } = decomposeForPersistence({
      root: plain,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml',
      classResolver: (item) => {
        if (item['type'] === 'folder') return Folder
        if (item['type'] === 'request') return Request
        return undefined
      }
    })
    const entry = children.find((c) => c.runtimeId === 'r1')
    expect(entry).toBeDefined()
    expect(entry?.absolutePath).toBe('/tmp/proj/01 - Folder/01 - R.yaml')
    // Custom resolver picked up Request class → @NonSerialised / @TreatEmptyAsUndefined
    // honored even though the input was a POJO.
    expect(entry?.content).toMatchObject({ id: 'r1', name: 'R', type: 'request' })
  })
})

describe('cleanseForPersistence', () => {
  it('strips @NonSerialised and @TreatEmptyAsUndefined from a single node', () => {
    const req = Object.assign(new Request(), {
      id: 'r1',
      name: 'R',
      url: 'u',
      note: '',
      runtimeCache: new Map([['x', 1]])
    })
    const out = cleanseForPersistence(req as unknown as Record<string, unknown>, Request)
    expect(out).toEqual({ id: 'r1', name: 'R', url: 'u' })
    expect(out).not.toHaveProperty('note')
    expect(out).not.toHaveProperty('runtimeCache')
  })

  it('returns the same shape the decomposer produces for the equivalent unit', () => {
    // Arrange: a folder tree with one request whose note is "" (→ dropped)
    // and a runtime cache (→ dropped). The decomposer walks the whole tree;
    // `cleanseForPersistence` walks just the request node. The content
    // slice in both cases should be identical — that symmetry is what
    // makes `commitIfDraftMatches` usable from the DocumentEvents bridge.
    const requestPojo = {
      id: 'r1',
      name: 'R',
      url: 'u',
      note: '',
      runtimeCache: { kept: false }
    }
    const envPojo = {
      id: 'env',
      name: 'Prod',
      baseUrl: '',
      collections: [
        {
          id: 'f1',
          name: 'Folder',
          items: [requestPojo],
          children: []
        }
      ]
    }

    const decomposed = decomposeForPersistence({
      root: envPojo,
      rootClass: Environment,
      basePath: '/tmp/proj',
      format: 'yaml',
      extension: 'yaml',
      classResolver: (item) => {
        if (item['items'] !== undefined) return Folder
        return Request
      }
    })

    const fromDecomposer = decomposed.children.find((c) => c.runtimeId === 'r1')?.content
    const fromCleanse = cleanseForPersistence(
      { ...requestPojo },
      Request
    )

    expect(fromDecomposer).toBeDefined()
    expect(fromCleanse).toEqual(fromDecomposer)
  })

  it('is a no-op when no decorators apply', () => {
    class Plain {
      a = 1
      b = 2
    }
    const out = cleanseForPersistence({ a: 1, b: 2 } as Record<string, unknown>, Plain)
    expect(out).toEqual({ a: 1, b: 2 })
  })
})
