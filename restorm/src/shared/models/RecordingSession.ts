/**
 * RecordingSession - records the API calls of a web page browsed in the
 * mini-browser and holds the routes deduced from them.
 *
 * A tree item placeable at the document root, in a folder or in an
 * env-folder (never inside a scenario). Like a scenario it doubles as a
 * container: its deduced routes live under `items` as ordinary folders +
 * requests. See `shared/types/recordingSession.ts` for the persisted
 * contract and what is deliberately NOT persisted (the captures).
 */

import {
  trackable,
  searchable,
  fileNaming,
  saveUnits,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import type { RuntimeId } from './types'
import type { FolderItem } from '../types/folderTypes'
import { RECORDING_PROTOCOLS, isRecordingProtocol, type RecordingProtocol } from '../types/recordingSession'

/** Keep only the protocol keys this build knows; an unknown key persisted
 * by a later build is dropped rather than carried blindly. Falls back to
 * every protocol when the slot is absent or empties out. */
function normalizeProtocols(raw: unknown): RecordingProtocol[] {
  if (!Array.isArray(raw)) return [...RECORDING_PROTOCOLS]
  const known = raw.filter(isRecordingProtocol)
  return known.length > 0 ? known : [...RECORDING_PROTOCOLS]
}

function normalizePatterns(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}

@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class RecordingSession {
  /** Discriminates a recording session from a request inside `FolderItem`. */
  readonly type = 'recording' as const

  /** Stable identifier persisted with the document. See `Folder.id`. */
  id!: RuntimeId

  /** Sidebar / tab label. */
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional user notes. */
  @searchable.property({ weight: 0.5 })
  @TreatEmptyAsUndefined()
  notes?: string

  /** The page to browse and listen on (http, https or file url). */
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Protocols captured during a recording. */
  protocols: RecordingProtocol[] = [...RECORDING_PROTOCOLS]

  /** Regex sources a captured url must match (any) to be kept — empty = all. */
  whitelist: string[] = []

  /** Regex sources that drop a captured url (any) — the last word. */
  blacklist: string[] = []

  /**
   * The deduced routes (folders + requests). Absent until the first
   * deduction. `@saveUnits()` mirrors `Scenario.items` so the save-unit
   * decomposition walks them like folder children. */
  @saveUnits()
  items?: FolderItem[]

  constructor(init?: Partial<RecordingSession>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    notes?: string
    url?: string
    protocols?: unknown
    whitelist?: unknown
    blacklist?: unknown
    items?: FolderItem[]
  }): RecordingSession {
    return new RecordingSession({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      url: typeof obj.url === 'string' ? obj.url : '',
      protocols: normalizeProtocols(obj.protocols),
      whitelist: normalizePatterns(obj.whitelist),
      blacklist: normalizePatterns(obj.blacklist),
      ...(obj.items !== undefined && { items: obj.items })
    })
  }

  toPlainObject(): Record<string, unknown> {
    return {
      type: this.type,
      id: this.id,
      name: this.name,
      notes: this.notes,
      url: this.url,
      protocols: this.protocols,
      whitelist: this.whitelist,
      blacklist: this.blacklist,
      ...(this.items !== undefined && { items: this.items })
    }
  }
}
