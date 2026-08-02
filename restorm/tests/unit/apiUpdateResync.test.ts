import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { applyApiUpdate } from '../../src/main/services/apiUpdate/applyApiUpdate'
import { importOpenAPI } from '../../src/main/services/import/OpenAPIImportService'
import { openapi3ImportAdapter } from '../../src/main/services/import/idempotent/OpenAPI3Adapter'
import { createRequestFromPlain } from '../../src/shared/models/requests/requestFactory'
import { isAnyFolder, isRequest } from '../../src/shared/types/folderTypes'
import type { EnvironmentFolder, FolderItem } from '../../src/shared/types/folderTypes'
import type { Request } from '../../src/shared/types/requests'

/**
 * End-to-end cover for "update from source": import a spec, live with
 * the result for a while (save, reload, edit a request), then re-sync
 * against a newer version of the same spec.
 *
 * What makes this different from `applyApiUpdate.test.ts` — which
 * hand-builds its tree — is `persistAndReload`. The real tree crosses
 * two serialization boundaries between the import and the refresh, and
 * a marker that doesn't survive them leaves the pipeline blind: every
 * operation looks new (duplicated on apply) and nothing looks
 * previously-imported (nothing to flag as removed). Driving the real
 * importer + the real request factory is what puts those boundaries
 * back into the test.
 */

interface OperationSpec {
  operationId: string
  summary: string
  deprecated?: boolean
}

function operation({ operationId, summary, deprecated }: OperationSpec): Record<string, unknown> {
  return {
    operationId,
    summary,
    ...(deprecated === true ? { deprecated: true } : {}),
    responses: { '200': { description: 'OK' } }
  }
}

const ID_PARAM = { name: 'id', in: 'path', required: true, schema: { type: 'string' } }

/** v1 — four operations, the state the user imported originally. */
function specV1(): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    info: { title: 'Inventory API', version: '1.0.0' },
    servers: [{ url: 'http://localhost:8788' }],
    paths: {
      '/items': {
        get: operation({ operationId: 'listItems', summary: 'List items' })
      },
      '/items/{id}': {
        parameters: [ID_PARAM],
        get: operation({ operationId: 'getItem', summary: 'Get item' }),
        delete: operation({ operationId: 'deleteItem', summary: 'Delete item' })
      }
    }
  }
}

/**
 * v2 — one operation ADDED (`POST /items`), one DEPRECATED
 * (`GET /items/{id}`), one REMOVED (`DELETE /items/{id}` is gone), one
 * UNCHANGED (`GET /items`, which the user has since customised).
 */
function specV2(): Record<string, unknown> {
  return {
    openapi: '3.0.0',
    info: { title: 'Inventory API', version: '2.0.0' },
    servers: [{ url: 'http://localhost:8788' }],
    paths: {
      '/items': {
        get: operation({ operationId: 'listItems', summary: 'List items' }),
        post: operation({ operationId: 'createItem', summary: 'Create item' })
      },
      '/items/{id}': {
        parameters: [ID_PARAM],
        get: operation({ operationId: 'getItem', summary: 'Get item', deprecated: true })
      }
    }
  }
}

/**
 * Put a freshly imported tree through the two hops that stand between
 * an import and the next refresh: the reify pass (`collections:sync`
 * from the renderer, or a project load) and the serializer that writes
 * the project file.
 */
function persistAndReload(folder: EnvironmentFolder): EnvironmentFolder {
  const walk = (items: FolderItem[]): FolderItem[] => items.map((item) => {
    if (isAnyFolder(item)) return { ...item, items: walk(item.items) } as FolderItem
    if (!isRequest(item)) return item
    const reified = createRequestFromPlain(item as never)
    const plain = reified.toPlainObject?.()
    if (!plain) throw new Error(`${reified.type} does not implement toPlainObject`)
    const onDisk = JSON.parse(JSON.stringify(plain)) as Record<string, unknown>
    return createRequestFromPlain(onDisk as never) as FolderItem
  })
  return { ...folder, items: walk(folder.items) }
}

function allRequests(folder: EnvironmentFolder): Request[] {
  const out: Request[] = []
  const walk = (items: readonly FolderItem[]): void => {
    for (const item of items) {
      if (isAnyFolder(item)) walk(item.items)
      else if (isRequest(item)) out.push(item)
    }
  }
  walk(folder.items)
  return out
}

/**
 * Match on the sidebar label rather than on `importOrigin`. The tree
 * the user looks at is the subject here, so the assertions must hold
 * even when the marker under test is missing — otherwise a regression
 * that wipes `importOrigin` would fail these tests by making the
 * lookups return nothing, and the duplication itself would go
 * unobserved.
 */
function byName(folder: EnvironmentFolder, name: string): Request[] {
  return allRequests(folder).filter((r) => r.name === name)
}

/** The one request carrying `name` — asserts uniqueness on the way,
 * so a duplicate fails here rather than silently picking the first. */
function only(folder: EnvironmentFolder, name: string): Request {
  const matches = byName(folder, name)
  expect(matches).toHaveLength(1)
  const [first] = matches
  if (!first) throw new Error(`no request named ${name}`)
  return first
}

function importedFolder(spec: Record<string, unknown>): EnvironmentFolder {
  return importOpenAPI(spec as never, { sourceUrl: 'http://localhost:8788/openapi.json' }) as unknown as EnvironmentFolder
}

function applyV2(target: EnvironmentFolder): ReturnType<typeof applyApiUpdate> {
  const v2 = specV2()
  return applyApiUpdate({
    target,
    freshFolder: importedFolder(v2),
    spec: openapi3ImportAdapter.extractNormalizedSpec(v2, {}),
    importSource: 'openapi'
  })
}

type EditableRequest = Request & {
  name: string
  method: string
  url: string
  params: { key: string; value: unknown }[]
}

/** The v1 project as it exists when the user hits Refresh: imported,
 * saved, reloaded, and customised on the one unchanged operation. */
function projectBeforeRefresh(): EnvironmentFolder {
  const folder = persistAndReload(importedFolder(specV1()))
  const edited = only(folder, 'List items') as EditableRequest
  edited.name = 'Mon listing perso'
  edited.method = 'HEAD'
  edited.url = '{{baseUrl}}/items?mine=1'
  edited.params.push({ key: 'mine', value: '1' } as never)
  return folder
}

describe('update from source (v1 → v2)', () => {
  it('adds, deprecates and marks removed exactly once, without duplicating anything', () => {
    const folder = projectBeforeRefresh()
    expect(allRequests(folder)).toHaveLength(3)

    const result = applyV2(folder)

    // Four operations total: the three from v1 (none deleted — a
    // removed op is kept and flagged) plus the one v2 introduces.
    expect(allRequests(folder)).toHaveLength(4)
    expect(byName(folder, 'Mon listing perso')).toHaveLength(1)
    expect(byName(folder, 'Get item')).toHaveLength(1)
    expect(byName(folder, 'Delete item')).toHaveLength(1)
    expect(byName(folder, 'Create item')).toHaveLength(1)
    // The re-imported copy of the customised operation must NOT land
    // beside the user's version — that is the shape of the bug.
    expect(byName(folder, 'List items')).toHaveLength(0)

    expect(result.diff.added.map((op) => op.naturalKey)).toEqual(['POST /items'])
    expect(result.diff.deprecated.map((op) => op.naturalKey)).toEqual(['GET /items/{id}'])
    expect(result.diff.removed.map((op) => op.naturalKey)).toEqual(['DELETE /items/{id}'])
  })

  it('marks the removed operation instead of deleting it, and the deprecated one deprecated', () => {
    const folder = projectBeforeRefresh()
    applyV2(folder)

    const gone = only(folder, 'Delete item')
    expect(gone.removed).toBe(true)

    const deprecated = only(folder, 'Get item')
    expect(deprecated.deprecated).toBe(true)
    expect(deprecated.removed).not.toBe(true)

    const added = only(folder, 'Create item')
    expect(added.removed).not.toBe(true)
    expect(added.deprecated).not.toBe(true)
  })

  it('reports both markings to the renderer, keyed by request id', () => {
    // The renderer keeps its own copy of the tree and only splices the
    // additions, so a flag main sets on its copy has to travel back in
    // the payload — otherwise nothing renders struck-through and the
    // renderer's next mirror erases the marking.
    const folder = projectBeforeRefresh()
    const goneBefore = only(folder, 'Delete item')
    const deprecatedBefore = only(folder, 'Get item')

    const { markedRequests } = applyV2(folder)

    expect(markedRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: goneBefore.id, removed: true }),
      expect.objectContaining({ id: deprecatedBefore.id, deprecated: true })
    ]))
    expect(markedRequests).toHaveLength(2)
  })

  it('preserves the user edits on an operation the spec still describes', () => {
    const folder = projectBeforeRefresh()
    applyV2(folder)

    const edited = only(folder, 'Mon listing perso') as EditableRequest
    expect(edited.name).toBe('Mon listing perso')
    expect(edited.method).toBe('HEAD')
    expect(edited.url).toBe('{{baseUrl}}/items?mine=1')
    expect(edited.params.find((p) => p.key === 'mine')?.value).toBe('1')
  })

  it('is idempotent: re-applying the same spec changes nothing', () => {
    const folder = projectBeforeRefresh()
    applyV2(folder)
    const afterFirst = allRequests(folder).length

    // Second refresh, through the same save/reload boundary the first
    // one left behind — this is the pass that used to double the tree.
    const reloaded = persistAndReload(folder)
    const second = applyV2(reloaded)

    expect(allRequests(reloaded)).toHaveLength(afterFirst)
    expect(byName(reloaded, 'Mon listing perso')).toHaveLength(1)
    expect(byName(reloaded, 'List items')).toHaveLength(0)
    expect(byName(reloaded, 'Create item')).toHaveLength(1)
    expect(second.diff.added).toHaveLength(0)
    expect(second.diff.deprecated).toHaveLength(0)
    expect(second.diff.removed).toHaveLength(0)
    expect(second.markedRequests).toHaveLength(0)
    // The removal survives the round-trip rather than being recomputed.
    expect(only(reloaded, 'Delete item').removed).toBe(true)
  })
})
