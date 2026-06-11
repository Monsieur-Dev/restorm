/**
 * Bridges a document tree (collections / environments / requests) and a
 * folder's `restorm.env` file for `envFileSecret` secrets.
 *
 * An env-file secret is a `SecretValue` whose `source` is `'envFileSecret'`.
 * Its plaintext never lands in the JSON/YAML document — it lives in the
 * sibling `restorm.env`, keyed by the value's *position* in the tree
 * (`{collection}/{path}/{scope}/{field}`). The in-memory plaintext rides on
 * `SecretValue.resolved` (a non-persisted field), exactly where the hydration
 * pipeline expects it.
 *
 *   - `collect…` walks the tree, derives each secret's positional key, reads the
 *     plaintext from `resolved`, and stamps `params.key` / `params.folderPath`
 *     so on-demand resolution stays self-contained.
 *   - `apply…` walks the tree, looks the plaintext up by positional key, writes
 *     it into `resolved`, and stamps the same params.
 */

export type SecretsMap = Record<string, string>

interface PlainValueType {
  type?: unknown
  source?: unknown
  params?: unknown
  resolved?: unknown
}

interface PlainKeyValue {
  key?: unknown
  value?: unknown
}

interface PlainEnvironment {
  name?: unknown
  variables?: unknown
  subEnvironments?: unknown
}

interface PlainFolder {
  name?: unknown
  items?: unknown
}

interface PlainEnvironmentFolder extends PlainFolder {
  folderType?: unknown
  environments?: unknown
}

interface PlainRequest {
  type?: unknown
  name?: unknown
  method?: unknown
  headers?: unknown
  params?: unknown
  pathParams?: unknown
  metadata?: unknown
  body?: unknown
}

const ENV_FILE_SECRET_SOURCE = 'envFileSecret'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function getPaddingWidth(count: number): number {
  if (count <= 0) return 1
  return String(count).length
}

function formatIndex(index0: number, count: number): string {
  const width = getPaddingWidth(count)
  return String(index0 + 1).padStart(width, '0')
}

function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function folderSegment(name: string, index0: number, count: number): string {
  return `${formatIndex(index0, count)} - ${sanitizeName(name)}`
}

function requestSegment(req: PlainRequest, index0: number, count: number): string {
  const name = typeof req.name === 'string' ? req.name : ''
  return `${formatIndex(index0, count)} - ${sanitizeName(name)}`
}

function isEnvFileSecret(value: unknown): value is PlainValueType {
  return (
    isRecord(value) &&
    (value as PlainValueType).type === 'secret' &&
    (value as PlainValueType).source === ENV_FILE_SECRET_SOURCE
  )
}

function getResolvedPlaintext(value: PlainValueType): string {
  return typeof value.resolved === 'string' ? value.resolved : ''
}

function setResolvedPlaintext(value: PlainValueType, secret: string): void {
  value.resolved = secret
}

/** Stamp the positional identity onto `params` so the resolver is self-contained. */
function stampParams(value: PlainValueType, key: string, folderPath: string | undefined): void {
  const params = isRecord(value.params) ? value.params : {}
  params['key'] = key
  if (folderPath !== undefined) params['folderPath'] = folderPath
  value.params = params
}

function isEnvironmentFolder(item: unknown): item is PlainEnvironmentFolder {
  if (!isRecord(item)) return false
  const folder = item as PlainEnvironmentFolder
  return isArray(folder.items) && folder.folderType === 'environment'
}

function isFolder(item: unknown): item is PlainFolder {
  if (!isRecord(item)) return false
  const folder = item as PlainEnvironmentFolder
  return isArray(folder.items) && folder.folderType !== 'environment'
}

function isRequest(item: unknown): item is PlainRequest {
  return isRecord(item) && typeof (item as PlainRequest).type === 'string' && !('items' in item)
}

function collectFromKeyValues(
  keyValues: unknown,
  basePath: string,
  scope: string,
  out: SecretsMap,
  folderPath: string | undefined
): void {
  if (!isArray(keyValues)) return

  for (const kvRaw of keyValues) {
    if (!isRecord(kvRaw)) continue
    const kv = kvRaw as PlainKeyValue
    const key = typeof kv.key === 'string' ? kv.key : ''
    if (!key) continue
    if (!isEnvFileSecret(kv.value)) continue

    const name = `${basePath}/${scope}/${key}`
    out[name] = getResolvedPlaintext(kv.value)
    stampParams(kv.value, name, folderPath)
  }
}

function applyToKeyValues(
  keyValues: unknown,
  basePath: string,
  scope: string,
  secrets: SecretsMap,
  folderPath: string | undefined
): void {
  if (!isArray(keyValues)) return

  for (const kvRaw of keyValues) {
    if (!isRecord(kvRaw)) continue
    const kv = kvRaw as PlainKeyValue
    const key = typeof kv.key === 'string' ? kv.key : ''
    if (!key) continue
    if (!isEnvFileSecret(kv.value)) continue

    const name = `${basePath}/${scope}/${key}`
    stampParams(kv.value, name, folderPath)
    const secret = secrets[name]
    if (typeof secret === 'string') {
      setResolvedPlaintext(kv.value, secret)
    }
  }
}

function collectFromEnvironment(
  envRaw: unknown,
  envFolderPath: string,
  envNameChain: string[],
  out: SecretsMap,
  folderPath: string | undefined
): void {
  if (!isRecord(envRaw)) return
  const env = envRaw as PlainEnvironment
  const envName = typeof env.name === 'string' ? sanitizeName(env.name) : ''
  if (!envName) return

  const nextChain = [...envNameChain, envName]
  const envPrefix = `${envFolderPath}/${nextChain.join('/')}`

  if (isArray(env.variables)) {
    for (const kvRaw of env.variables) {
      if (!isRecord(kvRaw)) continue
      const kv = kvRaw as PlainKeyValue
      const key = typeof kv.key === 'string' ? kv.key : ''
      if (!key) continue
      if (!isEnvFileSecret(kv.value)) continue
      const name = `${envPrefix}/${key}`
      out[name] = getResolvedPlaintext(kv.value)
      stampParams(kv.value, name, folderPath)
    }
  }

  if (isArray(env.subEnvironments)) {
    for (const child of env.subEnvironments) {
      collectFromEnvironment(child, envFolderPath, nextChain, out, folderPath)
    }
  }
}

function applyToEnvironment(
  envRaw: unknown,
  envFolderPath: string,
  envNameChain: string[],
  secrets: SecretsMap,
  folderPath: string | undefined
): void {
  if (!isRecord(envRaw)) return
  const env = envRaw as PlainEnvironment
  const envName = typeof env.name === 'string' ? sanitizeName(env.name) : ''
  if (!envName) return

  const nextChain = [...envNameChain, envName]
  const envPrefix = `${envFolderPath}/${nextChain.join('/')}`

  if (isArray(env.variables)) {
    for (const kvRaw of env.variables) {
      if (!isRecord(kvRaw)) continue
      const kv = kvRaw as PlainKeyValue
      const key = typeof kv.key === 'string' ? kv.key : ''
      if (!key) continue
      if (!isEnvFileSecret(kv.value)) continue

      const name = `${envPrefix}/${key}`
      stampParams(kv.value, name, folderPath)
      const secret = secrets[name]
      if (typeof secret === 'string') {
        setResolvedPlaintext(kv.value, secret)
      }
    }
  }

  if (isArray(env.subEnvironments)) {
    for (const child of env.subEnvironments) {
      applyToEnvironment(child, envFolderPath, nextChain, secrets, folderPath)
    }
  }
}

function collectFromRequest(
  req: PlainRequest,
  requestPath: string,
  out: SecretsMap,
  folderPath: string | undefined
): void {
  collectFromKeyValues(req.headers, requestPath, 'headers', out, folderPath)
  collectFromKeyValues(req.params, requestPath, 'params', out, folderPath)
  collectFromKeyValues(req.pathParams, requestPath, 'pathParams', out, folderPath)
  collectFromKeyValues(req.metadata, requestPath, 'metadata', out, folderPath)

  if (isRecord(req.body)) {
    const body = req.body as { fields?: unknown }
    if (isArray(body.fields)) {
      collectFromKeyValues(body.fields, requestPath, 'body.fields', out, folderPath)
    }
  }
}

function applyToRequest(
  req: PlainRequest,
  requestPath: string,
  secrets: SecretsMap,
  folderPath: string | undefined
): void {
  applyToKeyValues(req.headers, requestPath, 'headers', secrets, folderPath)
  applyToKeyValues(req.params, requestPath, 'params', secrets, folderPath)
  applyToKeyValues(req.pathParams, requestPath, 'pathParams', secrets, folderPath)
  applyToKeyValues(req.metadata, requestPath, 'metadata', secrets, folderPath)

  if (isRecord(req.body)) {
    const body = req.body as { fields?: unknown }
    if (isArray(body.fields)) {
      applyToKeyValues(body.fields, requestPath, 'body.fields', secrets, folderPath)
    }
  }
}

function walkFolderItemsCollect(
  items: unknown,
  prefix: string,
  out: SecretsMap,
  folderPath: string | undefined
): void {
  if (!isArray(items)) return

  for (let i = 0; i < items.length; i++) {
    const child = items[i]
    if (isFolder(child) || isEnvironmentFolder(child)) {
      const name = typeof child.name === 'string' ? child.name : ''
      if (!name) continue
      const nextPrefix = `${prefix}/${folderSegment(name, i, items.length)}`

      if (isEnvironmentFolder(child) && isArray(child.environments)) {
        for (const env of child.environments) {
          collectFromEnvironment(env, nextPrefix, [], out, folderPath)
        }
      }

      walkFolderItemsCollect(child.items, nextPrefix, out, folderPath)
      continue
    }

    if (isRequest(child)) {
      const reqPath = `${prefix}/${requestSegment(child, i, items.length)}`
      collectFromRequest(child, reqPath, out, folderPath)
    }
  }
}

function walkFolderItemsApply(
  items: unknown,
  prefix: string,
  secrets: SecretsMap,
  folderPath: string | undefined
): void {
  if (!isArray(items)) return

  for (let i = 0; i < items.length; i++) {
    const child = items[i]
    if (isFolder(child) || isEnvironmentFolder(child)) {
      const name = typeof child.name === 'string' ? child.name : ''
      if (!name) continue
      const nextPrefix = `${prefix}/${folderSegment(name, i, items.length)}`

      if (isEnvironmentFolder(child) && isArray(child.environments)) {
        for (const env of child.environments) {
          applyToEnvironment(env, nextPrefix, [], secrets, folderPath)
        }
      }

      walkFolderItemsApply(child.items, nextPrefix, secrets, folderPath)
      continue
    }

    if (isRequest(child)) {
      const reqPath = `${prefix}/${requestSegment(child, i, items.length)}`
      applyToRequest(child, reqPath, secrets, folderPath)
    }
  }
}

export function collectEnvFileSecretsFromCollections(data: unknown, folderPath?: string): SecretsMap {
  const out: SecretsMap = {}
  if (!isRecord(data)) return out
  const root = data as { collections?: unknown }
  if (!isArray(root.collections)) return out

  const collections = root.collections
  for (let i = 0; i < collections.length; i++) {
    const item = collections[i]
    if (!isRecord(item)) continue
    const collection = item as PlainEnvironmentFolder

    const name = typeof collection.name === 'string' ? collection.name : ''
    if (!name) continue

    const prefix = folderSegment(name, i, collections.length)

    if (isEnvironmentFolder(collection) && isArray(collection.environments)) {
      for (const env of collection.environments) {
        collectFromEnvironment(env, prefix, [], out, folderPath)
      }
    }

    walkFolderItemsCollect(collection.items, prefix, out, folderPath)
  }

  return out
}

export function applyEnvFileSecretsToCollections(
  data: unknown,
  secrets: SecretsMap,
  folderPath?: string
): void {
  if (!isRecord(data)) return
  const root = data as { collections?: unknown }
  if (!isArray(root.collections)) return

  const collections = root.collections
  for (let i = 0; i < collections.length; i++) {
    const item = collections[i]
    if (!isRecord(item)) continue
    const collection = item as PlainEnvironmentFolder

    const name = typeof collection.name === 'string' ? collection.name : ''
    if (!name) continue

    const prefix = folderSegment(name, i, collections.length)

    if (isEnvironmentFolder(collection) && isArray(collection.environments)) {
      for (const env of collection.environments) {
        applyToEnvironment(env, prefix, [], secrets, folderPath)
      }
    }

    walkFolderItemsApply(collection.items, prefix, secrets, folderPath)
  }
}
