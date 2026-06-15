import type { ValueSourceResolver, ResolveCtx } from '../../../../shared/secrets/ValueSource'
import {
  getFolderSecretsEnvPath,
  loadFolderSecretsEnvFile,
  upsertFolderSecretsEnvEntry
} from '../../SecretsEnvFileService'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Reads / writes a single entry of a folder's `restorm.env` file.
 *
 * The credential is identified by `params.key` (the hierarchical
 * `{collection}/{path}/{scope}/{field}` id) inside the `restorm.env` that lives
 * at `params.folderPath`. Both are stamped positionally at save / load time.
 */
export const envFileSecretResolver: ValueSourceResolver = {
  id: 'envFileSecret',

  async read(params: Record<string, unknown>, _ctx: ResolveCtx): Promise<string> {
    const key = asString(params['key'])
    const folderPath = asString(params['folderPath'])
    // An env-file secret with no owning `folderPath` has no `restorm.env` to
    // read: it was seeded as a placeholder (e.g. by an import) but never saved
    // into a project folder, and a single-file collection can never stamp a
    // `folderPath` at all. There is nothing to resolve, so this is the masked
    // empty state — resolve to `''` rather than throwing. Throwing here would
    // abort the dispatch of any request whose env chain merely contains the
    // unstamped secret, even when the request never references it.
    if (folderPath === '') {
      return ''
    }
    if (key === '') {
      throw new Error('envFileSecret key is empty')
    }
    const vars = await loadFolderSecretsEnvFile(folderPath)
    if (!vars || !(key in vars)) {
      throw new Error(`envFileSecret entry not found: ${key}`)
    }
    return vars[key] ?? ''
  },

  async write(params: Record<string, unknown>, value: string, _ctx: ResolveCtx): Promise<void> {
    const key = asString(params['key'])
    const folderPath = asString(params['folderPath'])
    if (key === '') {
      throw new Error('envFileSecret key is empty')
    }
    if (folderPath === '') {
      throw new Error('envFileSecret folderPath is empty')
    }
    // Touch the resolved path so a relative folderPath fails loudly here rather
    // than silently writing to the wrong place.
    getFolderSecretsEnvPath(folderPath)
    await upsertFolderSecretsEnvEntry(folderPath, key, value)
  }
}
