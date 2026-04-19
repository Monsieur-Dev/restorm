/**
 * Project UUID lifecycle for folder-mode projects.
 *
 * The project UUID is the stable identity of a project across renames
 * and moves of its directory — the draft store uses it to namespace
 * recovery files under `userData/drafts/<projectUuid>/`. It's stored
 * inside the root `index.<ext>` file next to the project's other
 * metadata so it survives when the user moves the folder.
 *
 * This module owns reading + generating + writing the UUID. Host apps
 * call `ensureProjectUuid(projectPath, format, extension)` right after
 * opening a folder project and hand the returned UUID to
 * `FileService.attachDraftStore`.
 */

import { promises as fs, existsSync } from 'fs'
import crypto from 'crypto'
import { join } from 'path'
import { atomicWriteFile, deserialize, serialize, type PersistenceFormat } from '../PersistenceService'

/**
 * Property name under which the UUID is stored in the root index
 * file. Chosen for stability — do not change without a migration.
 */
export const PROJECT_UUID_KEY = '_projectUuid'

export interface EnsureProjectUuidOptions {
  /** Absolute path of the project directory. */
  projectPath: string
  /** Serialization format of the index file. */
  format: PersistenceFormat
  /** Extension of the index file (without the dot). */
  extension: string
  /** Filename of the root index without extension. Defaults to `'index'`. */
  indexFileName?: string
}

interface EnsureProjectUuidResult {
  /** The UUID — existing or freshly generated. */
  uuid: string
  /** True when the UUID was just generated and written to disk. */
  generated: boolean
}

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Node without randomUUID (very old). Fall back to a structured random.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the project UUID from the root index file, generating + writing
 * one if it's missing. Safe to call at every project open — it's a
 * no-op on subsequent runs once the UUID has been persisted.
 *
 * If the root index file doesn't exist yet (brand-new project), one
 * is created with just `{ [PROJECT_UUID_KEY]: <uuid> }`. The host
 * app's normal save flow will add the rest of the fields on first
 * save.
 */
export async function ensureProjectUuid(options: EnsureProjectUuidOptions): Promise<EnsureProjectUuidResult> {
  const indexFileName = options.indexFileName ?? 'index'
  const indexPath = join(options.projectPath, `${indexFileName}.${options.extension}`)

  let existing: Record<string, unknown> = {}
  if (existsSync(indexPath)) {
    const raw = await fs.readFile(indexPath, 'utf-8')
    const parsed: unknown = deserialize(raw, options.format)
    if (isRecord(parsed)) existing = parsed
  }

  const currentValue = existing[PROJECT_UUID_KEY]
  if (typeof currentValue === 'string' && currentValue.length > 0) {
    return { uuid: currentValue, generated: false }
  }

  const fresh = uuid()
  const next = { ...existing, [PROJECT_UUID_KEY]: fresh }
  await atomicWriteFile(indexPath, serialize(next, options.format))
  return { uuid: fresh, generated: true }
}

/**
 * Read the UUID from the root index file without generating one.
 * Returns `undefined` when the file is missing, unreadable, or has
 * no UUID field. Useful for tooling that shouldn't mutate the project.
 */
export async function readProjectUuid(options: EnsureProjectUuidOptions): Promise<string | undefined> {
  const indexFileName = options.indexFileName ?? 'index'
  const indexPath = join(options.projectPath, `${indexFileName}.${options.extension}`)
  if (!existsSync(indexPath)) return undefined
  try {
    const raw = await fs.readFile(indexPath, 'utf-8')
    const parsed: unknown = deserialize(raw, options.format)
    if (!isRecord(parsed)) return undefined
    const value = parsed[PROJECT_UUID_KEY]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export interface EnsureFileProjectUuidOptions {
  /** Absolute path of the project file. */
  filePath: string
  /** Serialization format of the file. */
  format: PersistenceFormat
}

/**
 * File-mode equivalent of {@link ensureProjectUuid}: reads the single
 * project file, stamps a stable `_projectUuid` at its top level if
 * missing, and writes the result back atomically. The UUID is what
 * namespaces crash-recovery drafts under `userData/drafts/<uuid>/`,
 * giving file-mode and folder-mode the same recovery semantics even
 * though on-disk layouts differ.
 */
export async function ensureFileProjectUuid(options: EnsureFileProjectUuidOptions): Promise<EnsureProjectUuidResult> {
  let existing: Record<string, unknown> = {}
  if (existsSync(options.filePath)) {
    const raw = await fs.readFile(options.filePath, 'utf-8')
    const parsed: unknown = deserialize(raw, options.format)
    if (isRecord(parsed)) existing = parsed
  }

  const currentValue = existing[PROJECT_UUID_KEY]
  if (typeof currentValue === 'string' && currentValue.length > 0) {
    return { uuid: currentValue, generated: false }
  }

  const fresh = uuid()
  const next = { ...existing, [PROJECT_UUID_KEY]: fresh }
  await atomicWriteFile(options.filePath, serialize(next, options.format))
  return { uuid: fresh, generated: true }
}
