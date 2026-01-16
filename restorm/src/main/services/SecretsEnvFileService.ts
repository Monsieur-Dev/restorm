import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { promises as fs } from 'fs'
import { logger } from 'electron-core-ui/main'
import { collectPasswordSecretsFromCollections, applyPasswordSecretsToCollections } from '../../shared/utils/passwordSecrets'
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
  const secrets = collectPasswordSecretsFromCollections(data)
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

export async function applyFolderSecretsEnvFile(
  folderPath: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const vars = await loadFolderSecretsEnvFile(folderPath)
    if (vars) {
      applyPasswordSecretsToCollections(data, vars)
    }
  } catch (error) {
    logger.warn('Failed to read/apply restorm.env secrets file', { error: String(error) })
  }
}
