import { describe, it, expect } from 'vitest'
import { generateIds } from './serialization'

interface ReqItem { id?: string; type: string; name: string }
interface FolderItem { name: string; configuration: Record<string, unknown>; items: ReqItem[] }
interface Tree { collections: FolderItem[] }

function idsOf(tree: Tree): ReqItem[] {
  const out = generateIds(tree)
  const folder = out.collections[0]
  if (!folder) throw new Error('expected a folder')
  return folder.items
}

describe('generateIds — request-type id assignment', () => {
  it('assigns ids to every request kind incl. odata and auth', () => {
    const items = idsOf({
      collections: [
        { name: 'F', configuration: {}, items: [
          { name: 'h', type: 'http' },
          { name: 'g', type: 'graphql' },
          { name: 'r', type: 'grpc' },
          { name: 's', type: 'soap' },
          { name: 'w', type: 'websocket' },
          { name: 'o', type: 'odata' },
          { name: 'a', type: 'auth' }
        ] }
      ]
    })
    for (const item of items) {
      expect(typeof item.id, `${item.type} should have an id`).toBe('string')
      expect((item.id ?? '').length).toBeGreaterThan(0)
    }
    // The regression: odata + auth previously fell through and got no id.
    expect(items.find((i) => i.type === 'odata')?.id).toBeTruthy()
    expect(items.find((i) => i.type === 'auth')?.id).toBeTruthy()
  })

  it('regenerates a duplicate id on copy-paste of an odata/auth request', () => {
    const items = idsOf({
      collections: [
        { name: 'F', configuration: {}, items: [
          { name: 'o1', type: 'odata', id: 'dup-id' },
          { name: 'o2', type: 'odata', id: 'dup-id' },
          { name: 'a1', type: 'auth', id: 'dup-auth' },
          { name: 'a2', type: 'auth', id: 'dup-auth' }
        ] }
      ]
    })
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
