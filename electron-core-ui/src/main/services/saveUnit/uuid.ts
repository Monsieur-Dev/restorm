/**
 * Stable UUID lifecycle for files and folders persisted by `FileService`.
 *
 * A UUID is the durable identity of a saved document across renames and
 * moves of its path — the draft store uses it to namespace recovery
 * files under `userData/drafts/<uuid>/`, and consumers of the library
 * use it as the key for per-document preferences that must survive a
 * filesystem reshuffle (e.g. tree-expansion state, chosen environment,
 * favorites).
 *
 * The library intentionally does **not** hardcode a domain name into
 * the key it writes to disk — the caller passes `uuidKey` (defaulted to
 * `_uuid`) so each host app can own its on-disk vocabulary (one host
 * uses `_projectUuid`, another app could use `_documentUuid`, etc.)
 * without pulling library terminology into its file format.
 *
 * This module owns reading + generating + writing the UUID. Host apps
 * call `ensureFolderUuid` / `ensureFileUuid` right after opening a
 * project and hand the returned UUID to `FileService.attachDraftStore`.
 */

import { promises as fs, existsSync } from 'fs'
import crypto from 'crypto'
import { join } from 'path'
import { atomicWriteFile, deserialize, serialize, type PersistenceFormat } from '../PersistenceService'
import { setTopLevelKey } from './setTopLevelKey'

/**
 * Default property name under which the UUID is stored in the root
 * index / project file. Callers can override via `uuidKey` to match
 * their host-app naming convention.
 */
export const DEFAULT_UUID_KEY = '_uuid'

export interface EnsureFolderUuidOptions {
  /** Absolute path of the project directory. */
  projectPath: string
  /** Serialization format of the index file. */
  format: PersistenceFormat
  /** Extension of the index file (without the dot). */
  extension: string
  /** Filename of the root index without extension. Defaults to `'index'`. */
  indexFileName?: string
  /** Property name under which the UUID is stored. Defaults to `_uuid`. */
  uuidKey?: string
}

export interface EnsureUuidResult {
  /** The UUID — existing or freshly generated. */
  uuid: string
  /** True when the UUID was just generated and written to disk. */
  generated: boolean
  /**
   * False when a freshly generated UUID could NOT be written without
   * damaging the document, so the file was deliberately left alone (see
   * {@link stampUuid}). The UUID is still usable for this session; it
   * simply won't be the same one next time.
   */
  persisted: boolean
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
 * Read the UUID from the root index file, generating + writing one if
 * it's missing. Safe to call at every project open — it's a no-op on
 * subsequent runs once the UUID has been persisted.
 *
 * If the root index file doesn't exist yet (brand-new project), one is
 * created with just `{ [uuidKey]: <uuid> }`. The host app's normal save
 * flow will add the rest of the fields on first save.
 */
export async function ensureFolderUuid(options: EnsureFolderUuidOptions): Promise<EnsureUuidResult> {
  const indexFileName = options.indexFileName ?? 'index'
  const uuidKey = options.uuidKey ?? DEFAULT_UUID_KEY
  const indexPath = join(options.projectPath, `${indexFileName}.${options.extension}`)

  let existing: Record<string, unknown> = {}
  if (existsSync(indexPath)) {
    const raw = await fs.readFile(indexPath, 'utf-8')
    const parsed: unknown = deserialize(raw, options.format)
    if (isRecord(parsed)) existing = parsed
  }

  const currentValue = existing[uuidKey]
  if (typeof currentValue === 'string' && currentValue.length > 0) {
    return { uuid: currentValue, generated: false, persisted: true }
  }

  return await stampUuid(indexPath, uuidKey, options.format, existsSync(indexPath))
}

/**
 * Read the UUID from the root index file without generating one.
 * Returns `undefined` when the file is missing, unreadable, or has
 * no UUID field. Useful for tooling that shouldn't mutate the project.
 */
export async function readFolderUuid(options: EnsureFolderUuidOptions): Promise<string | undefined> {
  const indexFileName = options.indexFileName ?? 'index'
  const uuidKey = options.uuidKey ?? DEFAULT_UUID_KEY
  const indexPath = join(options.projectPath, `${indexFileName}.${options.extension}`)
  if (!existsSync(indexPath)) return undefined
  try {
    const raw = await fs.readFile(indexPath, 'utf-8')
    const parsed: unknown = deserialize(raw, options.format)
    if (!isRecord(parsed)) return undefined
    const value = parsed[uuidKey]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export interface EnsureFileUuidOptions {
  /** Absolute path of the project file. */
  filePath: string
  /** Serialization format of the file. */
  format: PersistenceFormat
  /** Property name under which the UUID is stored. Defaults to `_uuid`. */
  uuidKey?: string
}

/**
 * File-mode equivalent of {@link ensureFolderUuid}: reads the single
 * project file, stamps the UUID at its top level under `uuidKey` if
 * missing, and writes the result back atomically. The UUID is what
 * namespaces crash-recovery drafts under `userData/drafts/<uuid>/`,
 * giving file-mode and folder-mode the same recovery semantics even
 * though on-disk layouts differ.
 */
export async function ensureFileUuid(options: EnsureFileUuidOptions): Promise<EnsureUuidResult> {
  const uuidKey = options.uuidKey ?? DEFAULT_UUID_KEY
  let existing: Record<string, unknown> = {}
  if (existsSync(options.filePath)) {
    const raw = await fs.readFile(options.filePath, 'utf-8')
    const parsed: unknown = deserialize(raw, options.format)
    if (isRecord(parsed)) existing = parsed
  }

  const currentValue = existing[uuidKey]
  if (typeof currentValue === 'string' && currentValue.length > 0) {
    return { uuid: currentValue, generated: false, persisted: true }
  }

  return await stampUuid(options.filePath, uuidKey, options.format, existsSync(options.filePath))
}

/**
 * Write a freshly generated UUID into an existing document by INSERTING
 * the key into its text, never by reparsing and re-serializing it.
 *
 * The round-trip that used to live here — `serialize({ ...deserialize(raw),
 * [key]: uuid })` — silently destroyed comments, expanded YAML anchors
 * into duplicated content, and renormalised quoting and indentation. It
 * did so on a path the user experiences as *opening* a file, and it hit
 * hardest exactly where it hurt most: a document only lacks the UUID
 * when it was hand-authored or created outside the app, which is also
 * when it is most likely to carry comments and anchors worth keeping.
 *
 * When the insertion cannot be proven safe, the file is left completely
 * untouched and `persisted: false` is returned. Falling back to the
 * round-trip would reintroduce the very damage this avoids; an identity
 * that does not survive a restart is a far smaller cost than a document
 * that does not survive being opened.
 */
async function stampUuid(
  path: string,
  uuidKey: string,
  format: PersistenceFormat,
  fileExists: boolean
): Promise<EnsureUuidResult> {
  const fresh = uuid()

  // A document that does not exist yet has nothing to preserve, so
  // writing a fresh one is both safe and necessary (the host's save flow
  // fills in the rest).
  if (!fileExists) {
    await atomicWriteFile(path, serialize({ [uuidKey]: fresh }, format))
    return { uuid: fresh, generated: true, persisted: true }
  }

  const raw = await fs.readFile(path, 'utf-8')
  const stamped = setTopLevelKey(raw, uuidKey, fresh, format)
  if (stamped === null) {
    // Reporting is the caller's job: this module stays free of the
    // logger so it can be exercised without an Electron app around it.
    return { uuid: fresh, generated: true, persisted: false }
  }

  await atomicWriteFile(path, stamped)
  return { uuid: fresh, generated: true, persisted: true }
}
