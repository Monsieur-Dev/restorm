/**
 * The document-level format version of a FOLDER-mode project.
 *
 * In file mode the version rides along in the save payload, because a save
 * rewrites the whole document anyway. Folder mode has no such document:
 * `saveFolderStructure` writes one file per collection and deliberately
 * never replaces the project's root index — which is what keeps the
 * `_projectUuid` stamped there alive across saves. So the version has to
 * be put into that root index explicitly.
 *
 * It goes in by the same route the identity takes: `setTopLevelKey`
 * inserts the key into the file's TEXT and re-parses to prove the result
 * is exactly the previous document plus that one key. A parse/serialise
 * round-trip would discard the comments and expand the YAML anchors of a
 * file the user may well have hand-authored — the whole reason the
 * identity stamp stopped doing that.
 *
 * Every failure is a refusal, never a repair: the file is left exactly as
 * it is and the outcome says why. The version is metadata; the user's
 * project is not.
 */

import { promises as fs, existsSync } from 'fs'
import { join } from 'path'
import {
  atomicWriteFile,
  setTopLevelKey,
  serialize as coreSerialize,
  deserialize as coreDeserialize,
  type PersistenceFormat
} from 'electron-core-ui'
import { FILE_FORMAT_VERSION_KEY } from '../../shared/config/fileFormatVersion'

/**
 * What the stamp did. The caller decides which outcomes deserve a log
 * line; returning them instead of logging keeps this module free of the
 * app's logger and therefore exercisable on real files in a test.
 */
export type FolderFormatVersionStamp =
  /** No root index existed; one was created carrying just the version. */
  | 'created'
  /** The key was inserted into the existing root index. */
  | 'inserted'
  /** The root index already declares exactly this version. */
  | 'unchanged'
  /** It declares a DIFFERENT version: only a migration may move that. */
  | 'declares-another-version'
  /** The root index could not be parsed. */
  | 'unreadable'
  /** The insertion could not be proven safe, so nothing was written. */
  | 'refused'

/**
 * Ensure `<folderPath>/index.<ext>` declares `version` at its top level.
 *
 * Called on a save the user asked for — never on open. That is what makes
 * a project written before the version moved migrate at exactly the
 * moment the user was rewriting it anyway, and never as a side effect of
 * merely looking at it.
 */
export async function stampFolderFormatVersion(
  folderPath: string,
  ext: string,
  format: PersistenceFormat,
  version: number
): Promise<FolderFormatVersionStamp> {
  const indexPath = join(folderPath, `index.${ext}`)

  // A project with no root index yet (a first "save as folder") has
  // nothing to preserve, so writing one is both safe and the only way it
  // declares a version before it is next opened.
  if (!existsSync(indexPath)) {
    await atomicWriteFile(indexPath, coreSerialize({ [FILE_FORMAT_VERSION_KEY]: version }, format))
    return 'created'
  }

  const raw = await fs.readFile(indexPath, 'utf-8')
  let declared: unknown
  try {
    const parsed: unknown = coreDeserialize(raw, format)
    declared = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)[FILE_FORMAT_VERSION_KEY]
      : undefined
  } catch {
    return 'unreadable'
  }

  if (declared === version) return 'unchanged'
  if (typeof declared === 'number' && Number.isFinite(declared)) return 'declares-another-version'

  const stamped = setTopLevelKey(raw, FILE_FORMAT_VERSION_KEY, version, format)
  if (stamped === null) return 'refused'

  await atomicWriteFile(indexPath, stamped)
  return 'inserted'
}
