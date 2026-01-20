export type SecretsMap = Record<string, string>

interface PlainValueType {
  type?: unknown
  value?: unknown
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

function isPasswordValueType(value: unknown): value is PlainValueType {
  return isRecord(value) && (value as PlainValueType).type === 'password'
}

function getPasswordString(value: PlainValueType): string {
  return typeof value.value === 'string' ? value.value : ''
}

function setPasswordString(value: PlainValueType, secret: string): void {
  value.value = secret
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
  out: SecretsMap
): void {
  if (!isArray(keyValues)) return

  for (const kvRaw of keyValues) {
    if (!isRecord(kvRaw)) continue
    const kv = kvRaw as PlainKeyValue
    const key = typeof kv.key === 'string' ? kv.key : ''
    if (!key) continue
    if (!isPasswordValueType(kv.value)) continue

    const name = `${basePath}/${scope}/${key}`
    out[name] = getPasswordString(kv.value)
  }
}

function applyToKeyValues(
  keyValues: unknown,
  basePath: string,
  scope: string,
  secrets: SecretsMap
): void {
  if (!isArray(keyValues)) return

  for (const kvRaw of keyValues) {
    if (!isRecord(kvRaw)) continue
    const kv = kvRaw as PlainKeyValue
    const key = typeof kv.key === 'string' ? kv.key : ''
    if (!key) continue
    if (!isPasswordValueType(kv.value)) continue

    const name = `${basePath}/${scope}/${key}`
    const secret = secrets[name]
    if (typeof secret === 'string') {
      setPasswordString(kv.value, secret)
    }
  }
}

function collectFromEnvironment(
  envRaw: unknown,
  envFolderPath: string,
  envNameChain: string[],
  out: SecretsMap
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
      if (!isPasswordValueType(kv.value)) continue
      const name = `${envPrefix}/${key}`
      out[name] = getPasswordString(kv.value)
    }
  }

  if (isArray(env.subEnvironments)) {
    for (const child of env.subEnvironments) {
      collectFromEnvironment(child, envFolderPath, nextChain, out)
    }
  }
}

function applyToEnvironment(
  envRaw: unknown,
  envFolderPath: string,
  envNameChain: string[],
  secrets: SecretsMap
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
      if (!isPasswordValueType(kv.value)) continue

      const name = `${envPrefix}/${key}`
      const secret = secrets[name]
      if (typeof secret === 'string') {
        setPasswordString(kv.value, secret)
      }
    }
  }

  if (isArray(env.subEnvironments)) {
    for (const child of env.subEnvironments) {
      applyToEnvironment(child, envFolderPath, nextChain, secrets)
    }
  }
}

function collectFromRequest(req: PlainRequest, requestPath: string, out: SecretsMap): void {
  collectFromKeyValues(req.headers, requestPath, 'headers', out)
  collectFromKeyValues(req.params, requestPath, 'params', out)
  collectFromKeyValues(req.pathParams, requestPath, 'pathParams', out)
  collectFromKeyValues(req.metadata, requestPath, 'metadata', out)

  if (isRecord(req.body)) {
    const body = req.body as { fields?: unknown }
    if (isArray(body.fields)) {
      collectFromKeyValues(body.fields, requestPath, 'body.fields', out)
    }
  }
}

function applyToRequest(req: PlainRequest, requestPath: string, secrets: SecretsMap): void {
  applyToKeyValues(req.headers, requestPath, 'headers', secrets)
  applyToKeyValues(req.params, requestPath, 'params', secrets)
  applyToKeyValues(req.pathParams, requestPath, 'pathParams', secrets)
  applyToKeyValues(req.metadata, requestPath, 'metadata', secrets)

  if (isRecord(req.body)) {
    const body = req.body as { fields?: unknown }
    if (isArray(body.fields)) {
      applyToKeyValues(body.fields, requestPath, 'body.fields', secrets)
    }
  }
}

function walkFolderItemsCollect(items: unknown, prefix: string, out: SecretsMap): void {
  if (!isArray(items)) return

  for (let i = 0; i < items.length; i++) {
    const child = items[i]
    if (isFolder(child) || isEnvironmentFolder(child)) {
      const name = typeof child.name === 'string' ? child.name : ''
      if (!name) continue
      const nextPrefix = `${prefix}/${folderSegment(name, i, items.length)}`

      if (isEnvironmentFolder(child) && isArray(child.environments)) {
        for (const env of child.environments) {
          collectFromEnvironment(env, nextPrefix, [], out)
        }
      }

      walkFolderItemsCollect(child.items, nextPrefix, out)
      continue
    }

    if (isRequest(child)) {
      const reqPath = `${prefix}/${requestSegment(child, i, items.length)}`
      collectFromRequest(child, reqPath, out)
    }
  }
}

function walkFolderItemsApply(items: unknown, prefix: string, secrets: SecretsMap): void {
  if (!isArray(items)) return

  for (let i = 0; i < items.length; i++) {
    const child = items[i]
    if (isFolder(child) || isEnvironmentFolder(child)) {
      const name = typeof child.name === 'string' ? child.name : ''
      if (!name) continue
      const nextPrefix = `${prefix}/${folderSegment(name, i, items.length)}`

      if (isEnvironmentFolder(child) && isArray(child.environments)) {
        for (const env of child.environments) {
          applyToEnvironment(env, nextPrefix, [], secrets)
        }
      }

      walkFolderItemsApply(child.items, nextPrefix, secrets)
      continue
    }

    if (isRequest(child)) {
      const reqPath = `${prefix}/${requestSegment(child, i, items.length)}`
      applyToRequest(child, reqPath, secrets)
    }
  }
}

export function collectPasswordSecretsFromCollections(data: unknown): SecretsMap {
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
        collectFromEnvironment(env, prefix, [], out)
      }
    }

    walkFolderItemsCollect(collection.items, prefix, out)
  }

  return out
}

export function applyPasswordSecretsToCollections(data: unknown, secrets: SecretsMap): void {
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
        applyToEnvironment(env, prefix, [], secrets)
      }
    }

    walkFolderItemsApply(collection.items, prefix, secrets)
  }
}
