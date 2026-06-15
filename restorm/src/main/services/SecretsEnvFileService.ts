import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { promises as fs } from 'fs'
import { logger } from 'electron-core-ui/main'
import { collectEnvFileSecretsFromCollections, applyEnvFileSecretsToCollections } from '../../shared/utils/envFileSecrets'
import { parseEnvFileDetailed, serializeEnvFile } from '../../shared/utils/dotenv'

const RESTORM_ENV_FILE = 'restorm.env'

export function getFolderSecretsEnvPath(folderPath: string): string {
  return join(folderPath, RESTORM_ENV_FILE)
}

export async function saveFolderSecretsEnvFile(
  folderPath: string,
  data: Record<string, unknown>
): Promise<void> {
  const envPath = getFolderSecretsEnvPath(folderPath)
  const secrets = collectEnvFileSecretsFromCollections(data, folderPath)
  const keys = Object.keys(secrets)

  if (keys.length === 0) {
    if (existsSync(envPath)) {
      rmSync(envPath, { force: true })
    }
    return
  }

  await fs.writeFile(envPath, serializeEnvFile(secrets), 'utf-8')
}

export async function loadFolderSecretsEnvFile(folderPath: string): Promise<Record<string, string> | null> {
  const envPath = getFolderSecretsEnvPath(folderPath)
  if (!existsSync(envPath)) return null

  const envText = await fs.readFile(envPath, 'utf-8')
  const parsed = parseEnvFileDetailed(envText)
  if (parsed.duplicates.length > 0) {
    logger.warn('Duplicate keys found in restorm.env (last wins)', { duplicates: parsed.duplicates })
  }
  return parsed.vars
}

/**
 * Insert or update a single entry in a folder's `restorm.env`, preserving every
 * other entry. Used by the `envFileSecret` resolver's `write` path.
 */
export async function upsertFolderSecretsEnvEntry(
  folderPath: string,
  key: string,
  value: string
): Promise<void> {
  const existing = (await loadFolderSecretsEnvFile(folderPath)) ?? {}
  existing[key] = value
  await fs.writeFile(getFolderSecretsEnvPath(folderPath), serializeEnvFile(existing), 'utf-8')
}

export async function applyFolderSecretsEnvFile(
  folderPath: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const vars = await loadFolderSecretsEnvFile(folderPath)
    // Stamp params (key + folderPath) even when there is no env file yet, so
    // freshly-created secrets carry their identity for later resolution.
    applyEnvFileSecretsToCollections(data, vars ?? {}, folderPath)
  } catch (error) {
    logger.warn('Failed to read/apply restorm.env secrets file', { error: String(error) })
  }
}
