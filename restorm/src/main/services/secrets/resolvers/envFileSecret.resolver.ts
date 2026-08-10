import type { ValueSourceResolver, ResolveCtx } from '../../../../shared/secrets/ValueSource'
import { getFileService } from 'electron-core-ui'
import {
  getFolderSecretsEnvPath,
  loadFolderSecretsEnvFile,
  loadProjectSidecarEnvFile,
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
    if (key === '') {
      // A placeholder seeded by an import that was never saved — nothing to
      // resolve. `''` (the masked empty state) rather than a throw: throwing
      // would abort the dispatch of any request whose env chain merely
      // contains the unstamped secret.
      if (folderPath === '') return ''
      throw new Error('envFileSecret key is empty')
    }
    if (folderPath === '') {
      // Single-file mode: no `folderPath` is ever stamped — the sidecar is
      // derived from the OPEN project (`<project>.restorm.env`). A missing
      // sidecar or entry resolves to `''` (the value was simply never saved)
      // instead of throwing, for the same dispatch-safety reason as above.
      let projectPath: string | null = null
      try {
        projectPath = getFileService().getFilePath()
      } catch {
        // Not initialized (bare unit-test harness / very early boot) — same
        // masked empty state as an absent sidecar.
        return ''
      }
      if (!projectPath) return ''
      const vars = await loadProjectSidecarEnvFile(projectPath)
      return vars?.[key] ?? ''
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
