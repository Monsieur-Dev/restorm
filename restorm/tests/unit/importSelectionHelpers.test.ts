import { describe, it, expect } from 'vitest'
import { allLeafKeys, collectSelectableLeafKeys } from '../../src/renderer/src/components/Modals/importSelectionHelpers'
import { importNaturalKeyForFolder, importNaturalKeyForRequest } from '../../src/shared/utils/importNaturalKey'
import type { FolderItem, Folder } from '../../src/shared/types/folderTypes'
import type { HTTPRequest } from '../../src/shared/types/requests'

function http(method: HTTPRequest['method'], url: string): HTTPRequest {
  return { type: 'http', id: 'irrelevant', name: `${method} ${url}`, method, url } as unknown as HTTPRequest
}

function folder(name: string, items: FolderItem[] = []): Folder {
  return {
    id: 'irrelevant',
    name,
    documentation: '',
    tags: [],
    configuration: {} as unknown as Folder['configuration'],
    items
  }
}

describe('collectSelectableLeafKeys / allLeafKeys', () => {
  it('collects request keys for a normal request-bearing tree, unaffected by the doc-only fallback', () => {
    const tree: FolderItem[] = [
      folder('pet', [http('GET', '/pet/{petId}'), http('POST', '/pet')]),
      folder('store', [http('GET', '/store/inventory')])
    ]
    expect(collectSelectableLeafKeys(tree)).toEqual([
      'request:http:GET /pet/{petId}',
      'request:http:POST /pet',
      'request:http:GET /store/inventory'
    ])
    expect(allLeafKeys(tree)).toEqual(new Set([
      'request:http:GET /pet/{petId}',
      'request:http:POST /pet',
      'request:http:GET /store/inventory'
    ]))
  })

  it('falls back to the folder\'s own key when a folder subtree has zero requests (documentation-only import)', () => {
    const tree: FolderItem[] = [folder('PetService', []), folder('UserService', [])]
    expect(collectSelectableLeafKeys(tree)).toEqual([
      importNaturalKeyForFolder(['PetService']),
      importNaturalKeyForFolder(['UserService'])
    ])
    // Non-empty selection is exactly what enables the Import button —
    // pin the observable consequence, not just the key shape.
    expect(allLeafKeys(tree).size).toBe(2)
  })

  it('does not add a folder key when the folder has at least one request of its own', () => {
    const tree: FolderItem[] = [folder('pet', [http('GET', '/pet/{petId}')])]
    const keys = collectSelectableLeafKeys(tree)
    expect(keys).toEqual(['request:http:GET /pet/{petId}'])
    expect(keys).not.toContain(importNaturalKeyForFolder(['pet']))
  })

  it('only falls back for the empty subtree, not its non-empty siblings', () => {
    const tree: FolderItem[] = [
      folder('pet', [http('GET', '/pet/{petId}')]),
      folder('DocOnlyService', [])
    ]
    expect(collectSelectableLeafKeys(tree)).toEqual([
      'request:http:GET /pet/{petId}',
      importNaturalKeyForFolder(['DocOnlyService'])
    ])
  })

  it('an entirely empty tree yields no selectable keys', () => {
    expect(collectSelectableLeafKeys([])).toEqual([])
    expect(allLeafKeys([]).size).toBe(0)
  })

  it('importNaturalKeyForRequest keys still identify the same request regardless of the fallback', () => {
    const req = http('GET', '/x')
    expect(collectSelectableLeafKeys([folder('group', [req])])).toEqual([importNaturalKeyForRequest(req)])
  })
})
