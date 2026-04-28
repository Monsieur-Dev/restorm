import { logger } from 'electron-core-ui'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../shared/types/folderTypes'
import { authPrefetchOneShot, resolveProducedHeaders } from '../AuthenticationPrefetch'

/**
 * Run the env folder's attached auth route to produce the headers
 * the spec fetch needs. Mirrors the import-modal flow: walks the
 * folder for the request whose `id` matches `apiUpdate.authenticationRequestId`,
 * fires it via `authPrefetchOneShot`, resolves its `producedHeaders`
 * Handlebars against the response body, and returns the resulting
 * key/value map.
 *
 * Returns an empty object when:
 *
 * - no auth request is configured (caller should fall back to
 *   `apiUpdate.sourceHeaders` only),
 * - the configured id no longer matches any request in the folder
 *   (treat as if no auth is configured — the user can re-attach
 *   from the env folder home),
 * - the prefetch failed (errors logged, surfaces upstream as a
 *   401 / 403 on the spec fetch which the user already has UX for).
 */
interface AuthRequestLike {
  id?: string
  type?: string
  method?: string
  url?: string
  headers?: { key: string; value: string; enabled?: boolean }[]
  producedHeaders?: { key: string; value: string; enabled?: boolean }[]
  body?: { type?: string; content?: string }
}

function findRequestById(items: FolderItem[], id: string): AuthRequestLike | null {
  for (const item of items) {
    if (isAnyFolder(item)) {
      const inner = findRequestById(item.items, id)
      if (inner) return inner
      continue
    }
    if (isRequest(item)) {
      const r = item as AuthRequestLike
      if (r.id === id) return r
    }
  }
  return null
}

function resolveBody(body: AuthRequestLike['body']): string | undefined {
  if (!body) return undefined
  if (body.type === 'text' && typeof body.content === 'string') return body.content
  return undefined
}

export async function resolveAuthHeadersForFolder(
  folder: EnvironmentFolder,
  authenticationRequestId: string | undefined,
  variables: Record<string, string>
): Promise<Record<string, string>> {
  if (!authenticationRequestId) return {}
  const auth = findRequestById(folder.items, authenticationRequestId)
  if (auth?.type !== 'authentication') {
    logger.warn('[apiUpdate.resolveAuth] auth request not found in folder', { authenticationRequestId })
    return {}
  }
  if (!auth.method || !auth.url) return {}

  // Expand any `${VAR}` placeholders the auth route uses against
  // the env folder's variables. Mirrors the spec-fetch path so the
  // two sides resolve the same context.
  const url = expandVars(auth.url, variables)
  const headers = (auth.headers ?? []).map((h) => ({
    key: h.key,
    value: expandVars(h.value, variables),
    ...(h.enabled !== undefined ? { enabled: h.enabled } : {})
  }))
  const body = resolveBody(auth.body)

  const result = await authPrefetchOneShot({
    method: auth.method,
    url,
    headers,
    ...(body !== undefined ? { body } : {})
  })
  if (!result.success || result.statusCode === undefined || result.statusCode >= 400) {
    logger.warn('[apiUpdate.resolveAuth] prefetch failed', {
      statusCode: result.statusCode,
      error: result.error
    })
    return {}
  }
  return resolveProducedHeaders(auth.producedHeaders ?? [], result.body ?? '')
}

function expandVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, name: string) => vars[name] ?? match)
}
