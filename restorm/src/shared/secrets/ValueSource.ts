export interface ParamField {
  key: string
  labelKey: string
  kind: 'text' | 'password' | 'select'
  required?: boolean
  options?: { value: string; labelKey: string }[]
  placeholderKey?: string
}

/** Shared, renderer-safe. NO resolution logic. */
export interface ValueSourceDescriptor {
  id: string
  labelKey: string
  icon?: string
  canWrite: boolean
  isObject: boolean
  paramSchema?: ParamField[]
  configComponent?: string
  setupComponent?: string
}

export interface ResolveCtx {
  scopeId: string
  signal?: AbortSignal
}

/** Main-only. */
export interface ValueSourceResolver {
  id: string
  read(params: Record<string, unknown>, ctx: ResolveCtx): Promise<unknown>
  write?(params: Record<string, unknown>, value: string, ctx: ResolveCtx): Promise<void>
}

/** Dot-path extraction over an object payload. Returns string. */
export function extractSubKey(payload: unknown, path?: string): string {
  if (path == null || path === '') return typeof payload === 'string' ? payload : JSON.stringify(payload)
  let cur: unknown = payload
  for (const seg of path.split('.')) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      throw new Error(`secret sub-key not found: ${path}`)
    }
  }
  return typeof cur === 'string' ? cur : JSON.stringify(cur)
}
