import type {
  AdapterOptions,
  GenericOperationShape,
  ImportAdapter,
  NormalizedOperation,
  NormalizedSpec
} from './types'

/**
 * Bruno collections come in two flavours: a plain JSON export
 * shaped like Postman, or one `.bru` file per request collected by
 * the import service. The `BrunoImportService` already normalises
 * either into an in-memory tree of `{ name, items, requests }`; the
 * adapter consumes that structure.
 *
 * `naturalKey` mirrors the disk path so renames are flagged as
 * structural changes — Bruno's strength is git-based collection
 * sharing, and the path is the closest thing to a stable id.
 */
interface BrunoRequestLike {
  name?: string
  method?: string
  url?: string
  uid?: string
}

interface BrunoFolderLike {
  name?: string
  items?: (BrunoFolderLike | BrunoRequestLike)[]
  type?: string
}

interface BrunoCollectionLike {
  name?: string
  version?: string
  items?: (BrunoFolderLike | BrunoRequestLike)[]
}

function isFolder(item: BrunoFolderLike | BrunoRequestLike): item is BrunoFolderLike {
  return Array.isArray((item as BrunoFolderLike).items)
}

function flatten(items: (BrunoFolderLike | BrunoRequestLike)[], path: string[] = []): { request: BrunoRequestLike; path: string[] }[] {
  const out: { request: BrunoRequestLike; path: string[] }[] = []
  for (const item of items) {
    if (isFolder(item)) {
      const childPath = item.name ? [...path, item.name] : path
      out.push(...flatten(item.items ?? [], childPath))
      continue
    }
    out.push({ request: item, path })
  }
  return out
}

export const brunoImportAdapter: ImportAdapter = {
  format: 'bruno',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as BrunoCollectionLike
    const flat = flatten(spec.items ?? [])
    const operations: NormalizedOperation[] = flat.map(({ request, path }) => {
      const method = (request.method ?? 'GET').toUpperCase()
      const url = request.url ?? ''
      const naturalKey = `bruno ${path.join('/')}::${method} ${request.name ?? url}`
      const shape: GenericOperationShape = {
        protocol: 'bruno',
        raw: { method, url, name: request.name }
      }
      return {
        naturalKey,
        name: request.name ?? `${method} ${url}`,
        deprecated: false,
        shape,
        ...(request.uid !== undefined ? { operationId: request.uid } : {})
      }
    })
    return {
      ...(spec.version !== undefined ? { version: spec.version } : {}),
      operations,
      models: [],
      enums: [],
      environments: []
    }
  }
}
