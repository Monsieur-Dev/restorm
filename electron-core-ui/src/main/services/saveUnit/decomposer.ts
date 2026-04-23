/**
 * Class-driven, filesystem-agnostic decomposition of a tree into
 * per-save-unit persistence entries.
 *
 * Given a root document and its class constructor, this walks the
 * tree using `@separateFiles` / `@separateFolders` / `@fileNaming`
 * metadata and produces a flat list of `{ runtimeId, absolutePath,
 * content, format, kind }` entries that a host can hand to
 * `FileService.saveUnit` or `saveUnitsBatch`.
 *
 * Pure — no filesystem access. Safe to import from the renderer.
 */

import {
  getSeparateFilesProperties,
  getSeparateFoldersProperties,
  getNonSerialisedProperties,
  getTreatEmptyAsUndefinedProperties,
  generateFileName,
  type FileNamingConfig
} from '../../decorators'
import type { PersistenceFormat } from '../PersistenceService'

/**
 * Join path segments with the platform separator. The decomposer is
 * renderer-safe, so we can't pull `node:path` — inline a trivial
 * implementation that mirrors what `path.join` does for the shapes we
 * produce here (no `..`, no redundant slashes). Windows callers still
 * get back `\\`-separated paths because the `basePath` they pass in
 * already uses the native separator.
 */
function joinPath(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  const sep = a.includes('\\') && !a.includes('/') ? '\\' : '/'
  const endsWithSep = a.endsWith('/') || a.endsWith('\\')
  return endsWithSep ? `${a}${b}` : `${a}${sep}${b}`
}

/** Inline copy of `PersistenceService.calculateIndexPadding` (pure helper). */
function calculateIndexPadding(totalCount: number, minDigits = 2): number {
  return Math.max(minDigits, String(totalCount).length)
}

export interface DecomposedUnit {
  /** Stable identity from the item's `id` (or configured id property). */
  runtimeId: string
  /** Absolute destination path for the unit's file. */
  absolutePath: string
  /** Filtered + normalized content to write. */
  content: Record<string, unknown>
  /** Serialization format (driven by the project config). */
  format: PersistenceFormat
  /** `file` for `@separateFiles` items, `folder` for `@separateFolders` (their `index.<ext>`). */
  kind: 'file' | 'folder'
  /** Parent unit's id, or `undefined` for top-level units under the root. */
  parentId?: string | undefined
}

export interface DecomposedProject {
  /** The root `index.<ext>` — always present in folder mode. */
  rootIndex: DecomposedUnit
  /** Every `@separateFiles` / `@separateFolders` descendant, flattened. */
  children: DecomposedUnit[]
}

export interface DecomposeOptions {
  root: Record<string, unknown>
  rootClass: object
  basePath: string
  format: PersistenceFormat
  extension: string
  /** Defaults to `'index'` — matches the OYO-183 layout. */
  indexFileName?: string
  /** Property name used as the runtime identity. Default `'id'`. */
  idProperty?: string
  /**
   * Resolve the concrete class of a descendant item. The default
   * reads `item.constructor` when it isn't plain `Object`. Consumers
   * whose trees have lost class identity (e.g. after a JSON round
   * trip) can supply a resolver that maps by a discriminator field:
   *
   * ```ts
   * classResolver: (item, parentClass, propKey) =>
   *   item.type === 'http' ? HTTPRequest : item.type === 'soap' ? SoapRequest : undefined
   * ```
   */
  classResolver?: (item: Record<string, unknown>, parentClass: object | undefined, propKey: string) => object | undefined
  /**
   * Minimum number of digits to pad the numeric `{index}` token in
   * `@fileNaming` patterns and in the fallback naming helper. Defaults
   * to `2` to preserve historical layouts. Set to `1` if the host's
   * save-all writer uses a `max(1, digits)` padding scheme — keeping
   * per-unit save paths aligned avoids producing `01 - foo/` next to
   * an existing `1 - foo/`.
   */
  indexPaddingMin?: number
}

/**
 * Produce the persistence-ready slice of a single document node —
 * the same shape the decomposer emits as `DecomposedUnit.content`
 * for the node. Two steps, in order:
 *   1. Drop properties flagged `@separateFiles` / `@separateFolders`
 *      — those are lifted into their own files, never written to the
 *      parent's index.
 *   2. Cleanse the rest via `@NonSerialised` / `@TreatEmptyAsUndefined`.
 *
 * The DocumentEvents → upsert bridge uses this to compute the draft
 * it sends on every user edit, so `commitIfDraftMatches` can actually
 * match the decomposer's output at save time.
 */
export function cleanseForPersistence(
  data: Record<string, unknown>,
  classConstructor: object | undefined
): Record<string, unknown> {
  if (!classConstructor) return cleanse(data, undefined)
  const separateFilesProps = getSeparateFilesProperties(classConstructor)
  const separateFoldersProps = getSeparateFoldersProperties(classConstructor)
  if (separateFilesProps.size === 0 && separateFoldersProps.size === 0) {
    return cleanse(data, classConstructor)
  }
  const withoutSeparables: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (separateFilesProps.has(key) || separateFoldersProps.has(key)) continue
    withoutSeparables[key] = value
  }
  return cleanse(withoutSeparables, classConstructor)
}

function cleanse(
  data: Record<string, unknown>,
  classConstructor: object | undefined
): Record<string, unknown> {
  if (!classConstructor) return data
  const nonSerialised = getNonSerialisedProperties(classConstructor)
  const emptyDropped = getTreatEmptyAsUndefinedProperties(classConstructor)
  if (nonSerialised.size === 0 && emptyDropped.size === 0) return data
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (nonSerialised.has(key)) continue
    if (emptyDropped.has(key) && (value === null || value === '' || value === undefined)) continue
    out[key] = value
  }
  return out
}

/** Best-effort class resolution: use `item.constructor` when it isn't `Object`. */
function resolveItemClass(item: unknown): object | undefined {
  if (item === null || typeof item !== 'object') return undefined
  const ctor = (item as { constructor?: unknown }).constructor
  if (typeof ctor !== 'function') return undefined
  if (ctor === Object) return undefined
  return ctor
}

/**
 * Project-wide file naming convention for this release. The fallback
 * intentionally ignores `{type}` (removed in OYO-183) and always uses
 * `{counter} - {name}.<ext>`.
 */
function nameItem(
  item: Record<string, unknown>,
  index: number,
  totalCount: number,
  classConstructor: object | undefined,
  indexPaddingMin: number
): string {
  if (classConstructor) {
    return generateFileName(classConstructor, item, index, totalCount, indexPaddingMin)
  }
  const pattern: FileNamingConfig = {
    pattern: '{index} - {name}',
    nameProperty: 'name',
    idProperty: 'id'
  }
  const padding = calculateIndexPadding(totalCount, indexPaddingMin)
  const paddedIndex = String(index + 1).padStart(padding, '0')
  const rawName = item['name']
  const name = typeof rawName === 'string' ? rawName : ''
  return pattern.pattern
    .replace('{index}', paddedIndex)
    .replace('{name}', name)
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
}

function getId(item: Record<string, unknown>, idProperty: string): string {
  const raw = item[idProperty]
  return typeof raw === 'string' ? raw : ''
}

function processNode(params: {
  node: Record<string, unknown>
  nodeClass: object | undefined
  nodePath: string
  nodeKind: 'file' | 'folder'
  parentId: string | undefined
  format: PersistenceFormat
  extension: string
  indexFileName: string
  idProperty: string
  classResolver: (item: Record<string, unknown>, parentClass: object | undefined, propKey: string) => object | undefined
  accumulator: DecomposedUnit[]
  indexPaddingMin: number
}): Record<string, unknown> {
  const { node, nodeClass, nodePath, nodeKind, parentId, format, extension, indexFileName, idProperty, classResolver, accumulator, indexPaddingMin } = params

  // Collect the two decorator maps (empty when no class is known).
  const separateFilesProps = nodeClass ? getSeparateFilesProperties(nodeClass) : new Map<string | symbol, unknown>()
  const separateFoldersProps = nodeClass ? getSeparateFoldersProperties(nodeClass) : new Map<string | symbol, unknown>()

  // Keep a shallow copy of the content with separable props removed —
  // that's what lands in the node's own index / leaf file.
  const indexContent: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (separateFilesProps.has(key) || separateFoldersProps.has(key)) continue
    indexContent[key] = value
  }
  const cleanedIndexContent = cleanse(indexContent, nodeClass)

  // Recurse into separable arrays. We don't register the root entry
  // here — the caller builds the `rootIndex` outside.
  const nodeId = nodeKind === 'folder' ? getId(node, idProperty) : parentId
  for (const [propKey] of separateFilesProps) {
    if (typeof propKey !== 'string') continue
    const rawItems: unknown = node[propKey]
    if (!Array.isArray(rawItems)) continue
    const items = rawItems as unknown[]
    const totalCount = items.length
    for (let i = 0; i < items.length; i += 1) {
      const raw = items[i]
      if (raw === null || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const itemClass = classResolver(item, nodeClass, propKey)
      const fileName = nameItem(item, i, totalCount, itemClass, indexPaddingMin)
      const absPath = joinPath(nodePath, `${fileName}.${extension}`)
      accumulator.push({
        runtimeId: getId(item, idProperty),
        absolutePath: absPath,
        content: cleanse(item, itemClass),
        format,
        kind: 'file',
        parentId: nodeId
      })
    }
  }

  for (const [propKey] of separateFoldersProps) {
    if (typeof propKey !== 'string') continue
    const rawItems: unknown = node[propKey]
    if (!Array.isArray(rawItems)) continue
    const items = rawItems as unknown[]
    const totalCount = items.length
    for (let i = 0; i < items.length; i += 1) {
      const raw = items[i]
      if (raw === null || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const itemClass = classResolver(item, nodeClass, propKey)
      const folderName = nameItem(item, i, totalCount, itemClass, indexPaddingMin)
      const subFolderPath = joinPath(nodePath, folderName)
      const subIndexPath = joinPath(subFolderPath, `${indexFileName}.${extension}`)
      const itemId = getId(item, idProperty)
      // Recurse into the sub-folder first so descendants know about
      // their parent id before we register the folder itself.
      const subIndexContent = processNode({
        node: item,
        nodeClass: itemClass,
        nodePath: subFolderPath,
        nodeKind: 'folder',
        parentId: itemId,
        format,
        extension,
        indexFileName,
        idProperty,
        classResolver,
        accumulator,
        indexPaddingMin
      })
      accumulator.push({
        runtimeId: itemId,
        absolutePath: subIndexPath,
        content: subIndexContent,
        format,
        kind: 'folder',
        parentId: nodeId
      })
    }
  }

  return cleanedIndexContent
}

export function decomposeForPersistence(options: DecomposeOptions): DecomposedProject {
  const extension = options.extension
  const indexFileName = options.indexFileName ?? 'index'
  const idProperty = options.idProperty ?? 'id'
  const classResolver = options.classResolver ?? ((item) => resolveItemClass(item))
  const indexPaddingMin = options.indexPaddingMin ?? 2

  const children: DecomposedUnit[] = []
  const rootIndexContent = processNode({
    node: options.root,
    nodeClass: options.rootClass,
    nodePath: options.basePath,
    nodeKind: 'folder',
    parentId: undefined,
    format: options.format,
    extension,
    indexFileName,
    idProperty,
    classResolver,
    accumulator: children,
    indexPaddingMin
  })

  const rootIndex: DecomposedUnit = {
    runtimeId: getId(options.root, idProperty),
    absolutePath: joinPath(options.basePath, `${indexFileName}.${extension}`),
    content: rootIndexContent,
    format: options.format,
    kind: 'folder'
  }

  return { rootIndex, children }
}
