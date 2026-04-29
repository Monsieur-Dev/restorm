import type {
  AdapterOptions,
  GenericOperationShape,
  ImportAdapter,
  NormalizedOperation,
  NormalizedSpec
} from './types'

/**
 * Insomnia exports a flat `resources[]` array discriminated by
 * `_type`. The idempotent pipeline only consumes the `request`
 * resources; folders (`request_group`) are walked just to compute a
 * stable `naturalKey` that includes the folder path.
 *
 * `_id` is preserved as `operationId` — Insomnia generates it
 * deterministically per resource (`req_xxxxx`), so it survives
 * re-exports better than the request name + URL.
 */
interface InsomniaResourceLike {
  _id?: string
  _type?: string
  parentId?: string
  name?: string
  method?: string
  url?: string
}

interface InsomniaExportLike {
  _type?: string
  __export_format?: number
  __export_source?: string
  resources?: InsomniaResourceLike[]
}

function buildPath(resources: InsomniaResourceLike[], startId: string | undefined): string[] {
  const byId = new Map<string, InsomniaResourceLike>()
  for (const r of resources) {
    if (r._id) byId.set(r._id, r)
  }
  const path: string[] = []
  let cursor = startId
  // Cap depth to keep a malformed export from looping. 32 is plenty
  // for hand-built collections.
  for (let i = 0; i < 32 && cursor; i++) {
    const parent = byId.get(cursor)
    if (parent?._type !== 'request_group') break
    if (parent.name) path.unshift(parent.name)
    cursor = parent.parentId
  }
  return path
}

export const insomniaImportAdapter: ImportAdapter = {
  format: 'insomnia',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as InsomniaExportLike
    const resources = spec.resources ?? []
    const operations: NormalizedOperation[] = []
    for (const r of resources) {
      if (r._type !== 'request') continue
      const method = (r.method ?? 'GET').toUpperCase()
      const url = r.url ?? ''
      const path = buildPath(resources, r.parentId)
      const naturalKey = `insomnia ${path.join('/')}::${method} ${r.name ?? url}`
      const shape: GenericOperationShape = {
        protocol: 'insomnia',
        raw: { method, url, name: r.name }
      }
      operations.push({
        naturalKey,
        name: r.name ?? `${method} ${url}`,
        deprecated: false,
        shape,
        ...(r._id !== undefined ? { operationId: r._id } : {})
      })
    }
    return {
      operations,
      models: [],
      enums: [],
      environments: []
    }
  }
}
