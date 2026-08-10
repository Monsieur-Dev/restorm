/**
 * Restorm → Restorm project import: merge the contents of another `.restorm`
 * file into the currently-open project.
 *
 * Unlike every other importer here, the payload is not an external spec but
 * a full Restorm project document — the same YAML the app itself saves. Two
 * consequences drive everything below:
 *
 * - **Fresh identities, always.** The imported file's ids may collide with
 *   the open project's — the user may even import a file into itself, which
 *   must yield a clean duplicate set alongside the originals. So `parse`
 *   re-identifies its whole output (fresh id on every id-bearing node,
 *   every known reference remapped) via the same shared primitive the
 *   Clone action uses. This deliberately diverges from the playbook's
 *   "idempotent re-import" rule (stable ids, dedup on re-import): for a
 *   project merge, duplication IS the specified behaviour, dedup would be
 *   data loss. The renderer's import flow re-identifies once more on
 *   insertion; two full passes compose safely.
 * - **No spec-import hygiene.** The content is user-authored data, saved
 *   exactly as the user wanted it — `preserveEmptyKeyValues` opts out of
 *   the empty-row auto-disable, and there is no `postImportSeed` / no
 *   `apiUpdate` source to refresh from (a one-shot import, like cURL/HAR).
 *
 * The file-format gate matches the open path exactly
 * (`checkFileFormatCompatibility`): a document declaring a NEWER format
 * version — or none at all — is refused with a coded, translatable error.
 * An importer more permissive than the open path would let content this
 * build cannot fully read get merged and then saved back, silently
 * impoverished.
 *
 * Secret values are NOT imported: an `envFileSecret` variable's plaintext
 * lives in the source project's `.restorm.env` sidecar, keyed by that
 * project's folder/env layout. The variable STRUCTURE is imported (the
 * secret stays unresolved until the user fills it in); carrying values
 * across projects is the extensible secret-source model's job, not the
 * merge's.
 */

import * as path from 'node:path'
import { parse as yamlParse } from 'yaml'
import type { Folder, FolderItem } from '../../../shared/types/collections'
import { checkFileFormatCompatibility, FILE_FORMAT_TOO_NEW_CODE } from '../../../shared/config/fileFormatVersion'
import { formatImportError } from '../../../shared/config/importErrors'
import { generateUniqueId, reidentifyForest } from '../../../shared/utils/reidentifyTree'
import { importProviders } from './registry'

export const RESTORM_IMPORT_FORMAT = 'restorm'

const RESTORM_EXTENSION = '.restorm'

/** Root-key sniff on the raw YAML text — both keys the open path requires,
 * without parsing the document. Anchored to line starts so a spec that merely
 * MENTIONS the words (an OpenAPI description, a README) can't claim it. */
function looksLikeRestormProject(content: string): boolean {
  return /^fileFormatVersion\s*:/m.test(content) && /^collections\s*:/m.test(content)
}

function canImport(content: string, filePath?: string): boolean {
  if (filePath?.toLowerCase().endsWith(RESTORM_EXTENSION) === true) return true
  if (content === '') return false
  return looksLikeRestormProject(content)
}

/** The wrapping folder's name: the source file's basename. Everything the
 * import brings in lands under ONE folder so the merge is legible in the
 * sidebar and reversible with a single delete. Pasted content has no
 * filename to speak of — the format's display name stands in. */
function wrapperName(filePath: string | undefined): string {
  if (filePath === undefined) return 'Restorm'
  const base = path.basename(filePath)
  return base.toLowerCase().endsWith(RESTORM_EXTENSION) ? base.slice(0, -RESTORM_EXTENSION.length) : base
}

function parse(content: string, opts: { sourceUrl?: string; filePath?: string }): Folder {
  // yaml's own failure (malformed document) propagates as-is: untranslatable
  // upstream text belongs in the error's detail slot, not in a coded frame.
  const doc: unknown = yamlParse(content)

  // Same gate as opening the file, same two refusals — travel as coded
  // messages so the modal renders a translated sentence.
  const compat = checkFileFormatCompatibility(doc)
  if (!compat.supported) {
    if (compat.code === FILE_FORMAT_TOO_NEW_CODE) {
      throw new Error(formatImportError('projectFormatTooNew', {
        found: String(compat.found),
        current: String(compat.current)
      }))
    }
    throw new Error(formatImportError('projectFormatMissing'))
  }

  const collections = (doc as { collections?: unknown }).collections
  const items: FolderItem[] = Array.isArray(collections) ? (collections as FolderItem[]) : []

  const wrapper: Folder = {
    id: generateUniqueId(),
    name: wrapperName(opts.filePath),
    tags: [],
    configuration: {},
    items
  }

  // Re-identify HERE, not only in the renderer's import flow: the MCP
  // import path inserts `parse()`'s output unchanged, and this format's
  // source ids can collide with the very project it's being merged into.
  // The renderer's own re-identification pass then runs on top — two full
  // passes compose safely (each produces a consistent id set).
  reidentifyForest([wrapper])

  return wrapper
}

importProviders.push({
  format: RESTORM_IMPORT_FORMAT,
  preserveEmptyKeyValues: true,
  canImport,
  parse
})
