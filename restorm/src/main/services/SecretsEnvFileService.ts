import { join } from 'path'
import { promises as fs } from 'fs'
import { logger } from 'electron-core-ui/main'
import { collectEnvFileSecretsFromCollections, applyEnvFileSecretsToCollections } from '../../shared/utils/envFileSecrets'
import { parseEnvFileDetailed, serializeEnvFile } from '../../shared/utils/dotenv'

const RESTORM_ENV_FILE = 'restorm.env'

export function getFolderSecretsEnvPath(folderPath: string): string {
  return join(folderPath, RESTORM_ENV_FILE)
}

/**
 * Per-env-file write queue. Writing `restorm.env` is a load → mutate →
 * write cycle (upsert) or a whole-file replace (save). Two concurrent
 * un-serialised writers — e.g. two secret upserts in the same tick, or
 * an upsert racing a save — both read the pre-mutation file and the
 * second write clobbers the first (a TOCTOU lost-update). Chaining every
 * write for a given path onto the previous one serialises them.
 */
const envWriteChains = new Map<string, Promise<void>>()

function runSerializedEnvWrite(envPath: string, task: () => Promise<void>): Promise<void> {
  const prev = envWriteChains.get(envPath) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(task)
  envWriteChains.set(envPath, next)
  void next.catch(() => undefined).finally(() => {
    if (envWriteChains.get(envPath) === next) envWriteChains.delete(envPath)
  })
  return next
}

export async function saveFolderSecretsEnvFile(
  folderPath: string,
  data: Record<string, unknown>
): Promise<void> {
  const envPath = getFolderSecretsEnvPath(folderPath)
  const secrets = collectEnvFileSecretsFromCollections(data, folderPath)
  const keys = Object.keys(secrets)

  return runSerializedEnvWrite(envPath, async () => {
    if (keys.length === 0) {
      // `force` makes a missing file a no-op, so no existence pre-check needed.
      await fs.rm(envPath, { force: true })
      return
    }
    await fs.writeFile(envPath, serializeEnvFile(secrets), 'utf-8')
  })
}

/**
 * Load the SINGLE-FILE project's secrets sidecar (`<project>.restorm.env`,
 * i.e. the open `.restorm` path + `.env`). Same parse + duplicate policy as
 * the folder variant; `null` when the sidecar doesn't exist yet.
 */
export async function loadProjectSidecarEnvFile(projectPath: string): Promise<Record<string, string> | null> {
  const envPath = `${projectPath}.env`
  let envText: string
  try {
    envText = await fs.readFile(envPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const parsed = parseEnvFileDetailed(envText)
  if (parsed.duplicates.length > 0) {
    logger.warn('Duplicate keys found in the project sidecar .env (last wins)', { duplicates: parsed.duplicates })
  }
  return parsed.vars
}

export async function loadFolderSecretsEnvFile(folderPath: string): Promise<Record<string, string> | null> {
  const envPath = getFolderSecretsEnvPath(folderPath)

  let envText: string
  try {
    envText = await fs.readFile(envPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
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
  const envPath = getFolderSecretsEnvPath(folderPath)
  // The whole load → mutate → write runs inside the serialized task so a
  // concurrent upsert/save can't read the same pre-mutation file and
  // clobber this entry.
  return runSerializedEnvWrite(envPath, async () => {
    const existing = (await loadFolderSecretsEnvFile(folderPath)) ?? {}
    existing[key] = value
    await fs.writeFile(envPath, serializeEnvFile(existing), 'utf-8')
  })
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
