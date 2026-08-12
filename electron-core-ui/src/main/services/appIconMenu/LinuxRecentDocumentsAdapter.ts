import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import { logger } from '../LoggerService'
import { RECENT_FILES_ENTRY_ID } from '../../../types/appIconMenu'
import type { AppIconMenuAdapter, AppIconMenuModel, AppIconMenuEntry } from '../AppIconMenuService'
import type { AppIconAction } from '../../../types/appIconMenu'

/**
 * Linux app-icon menu, via the freedesktop **recent-documents** store.
 *
 * Desktops that show a per-app "Recent Files" section on the task-manager entry
 * (KDE Plasma, GNOME, docks) read `~/.local/share/recently-used.xbel` — the
 * shared XBEL file every GTK app maintains through `GtkRecentManager`. Electron
 * offers no Linux equivalent of `app.addRecentDocument`, so this adapter writes
 * that file directly, tagging each entry with the host application so the
 * launcher attributes the recents to the right icon.
 *
 * Only the recent list is represented here: "new file" is a static, localized
 * `.desktop` action shipped with the package, and favorites have no standard
 * launcher slot — both fall outside this store by design.
 *
 * The file is shared with every other app, so writes are careful: entries owned
 * exclusively by this app are regenerated from the current list, and everything
 * else is preserved verbatim. Any failure degrades to a no-op rather than
 * risking a corrupt file.
 */

/** Attribute prefix used for the parsed/!built XML object shape. */
const ATTR = '@_'
/** Owner URI freedesktop stamps on the metadata block. */
const METADATA_OWNER = 'http://freedesktop.org'
/** XML preamble GtkRecentManager writes; re-emitted so other readers are happy. */
const XML_HEADER =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" ' +
  '"http://www.python.org/topics/xml/dtds/xbel-1.0.dtd">\n'

/** A recent file, reduced to what the XBEL entry needs. */
interface RecentFile {
  path: string
  name: string
}

/** Options for {@link LinuxRecentDocumentsAdapter}. */
export interface LinuxRecentDocumentsAdapterOptions {
  /**
   * The name recorded on this app's XBEL entries. Defaults to the Electron app
   * name; must match how the launcher labels the app for the recents to group
   * under it.
   */
  appName?: string | undefined
  /**
   * The command the launcher associates the recents with — it has to resolve to
   * the same program as the installed `.desktop` `Exec`. When unset it is read
   * from the installed entry named by {@link desktopFileId}.
   */
  exec?: string | undefined
  /**
   * The installed `.desktop` file id, used to read the exact `Exec` the launcher
   * matches recents against. Preferred over guessing from the running process,
   * whose path can differ from the launcher's (e.g. an Electron `.bin` wrapper).
   */
  desktopFileId?: string | undefined
  /** MIME type stamped on each entry (e.g. `application/x-myapp`). Omitted if unset. */
  mimeType?: string | undefined
}

/** ISO-8601 with second precision, the form GtkRecentManager writes. */
const isoSeconds = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Read the `Exec` value of an installed desktop entry, if it can be found. */
const readDesktopExec = (desktopFileId: string): string | null => {
  const dataDirs = process.env['XDG_DATA_DIRS'] ?? '/usr/local/share:/usr/share'
  for (const dir of dataDirs.split(':').filter(Boolean)) {
    const path = join(dir, 'applications', desktopFileId)
    try {
      if (!existsSync(path)) continue
      const line = readFileSync(path, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('Exec='))
      if (line) return line.slice('Exec='.length).trim()
    } catch {
      // unreadable candidate — try the next data dir
    }
  }
  return null
}

/**
 * The launch command the launcher matches recents against. Prefer the installed
 * entry's `Exec`; fall back to this process minus the Electron `.bin` wrapper
 * suffix (the launcher runs the wrapper, not the `.bin`).
 */
const resolveExec = (desktopFileId: string | undefined): string => {
  const fromDesktop = desktopFileId ? readDesktopExec(desktopFileId) : null
  if (fromDesktop) return fromDesktop
  return `${process.execPath.replace(/\.bin$/, '')} %U`
}

/** Coerce fast-xml-parser's "one-or-many" shape into an array. */
const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/** Pull the recent-file entries out of the neutral model. */
const recentFilesOf = (model: AppIconMenuModel): RecentFile[] => {
  const entry = model.entries.find((e: AppIconMenuEntry) => e.id === RECENT_FILES_ENTRY_ID)
  if (!entry?.submenu) return []
  const files: RecentFile[] = []
  for (const child of entry.submenu) {
    if (child.action?.kind === 'open-file') files.push({ path: child.action.path, name: child.label })
  }
  return files
}

export class LinuxRecentDocumentsAdapter implements AppIconMenuAdapter {
  private readonly appName: string
  private readonly exec: string
  private readonly mimeType: string | undefined
  private readonly filePath: string
  private available = true
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR,
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: true
  })
  private readonly builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR,
    format: true,
    suppressEmptyNode: false,
    processEntities: true
  })

  constructor(options: LinuxRecentDocumentsAdapterOptions = {}) {
    this.appName = options.appName ?? app.getName()
    this.exec = options.exec ?? resolveExec(options.desktopFileId)
    this.mimeType = options.mimeType
    const dataHome = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share')
    this.filePath = join(dataHome, 'recently-used.xbel')
  }

  public apply(model: AppIconMenuModel, _dispatch: (action: AppIconAction) => void): void {
    // The launcher relaunches this app with the file as an argument when a
    // recent is chosen; nothing calls back into the running process, so
    // `dispatch` has no role here (as with the Windows jump list).
    this.sync(recentFilesOf(model))
  }

  public clear(): void {
    this.sync([])
  }

  /**
   * Make the shared store reflect exactly `files` for this app, best-effort.
   *
   * A file may already have a bookmark written by another writer — notably the
   * GTK file-chooser portal, which records its own generic application. Rather
   * than skip such entries (which would leave them unattributed to us and so
   * ungrouped under our launcher icon), this **merges** our application onto the
   * existing bookmark. Bookmarks that are not ours and not in the list are kept
   * verbatim; bookmarks that were exclusively ours but dropped out of the list
   * are removed.
   */
  private sync(files: RecentFile[]): void {
    if (!this.available || process.platform !== 'linux') return
    try {
      const now = Date.now()
      const wanted = new Map<string, { file: RecentFile; visitedMs: number }>()
      files.forEach((file, index) => {
        wanted.set(pathToFileURL(file.path).href, { file, visitedMs: now - index * 1000 })
      })

      const result: Record<string, unknown>[] = []
      const handled = new Set<string>()
      for (const bookmark of this.readBookmarks()) {
        const href = bookmark[`${ATTR}href`] as string
        const want = wanted.get(href)
        if (want) {
          result.push(this.attributeToUs(bookmark, want.visitedMs))
          handled.add(href)
        } else if (!this.isExclusivelyOurs(bookmark)) {
          result.push(bookmark)
        }
      }
      for (const [href, want] of wanted) {
        if (!handled.has(href)) result.push(this.buildBookmark(want.file, want.visitedMs))
      }
      this.write(result)
    } catch (error) {
      logger.error('Failed to sync Linux recent documents', { error: String(error) })
      // A single malformed write shouldn't keep retrying against a shared file.
      this.available = false
    }
  }

  /** Parse every bookmark in the store (or `[]` when it is absent/empty). */
  private readBookmarks(): Record<string, unknown>[] {
    if (!existsSync(this.filePath)) return []
    const raw = readFileSync(this.filePath, 'utf8')
    if (!raw.trim()) return []
    // fast-xml-parser doesn't consume the XML declaration / DOCTYPE; strip them.
    const body = raw.replace(/<\?xml[^>]*\?>\s*/i, '').replace(/<!DOCTYPE[^>]*>\s*/i, '')
    const parsed = this.parser.parse(body) as { xbel?: { bookmark?: unknown } }
    return asArray(parsed.xbel?.bookmark) as Record<string, unknown>[]
  }

  /** True when this app is the sole application recorded on a bookmark. */
  private isExclusivelyOurs(bookmark: Record<string, unknown>): boolean {
    const info = bookmark['info'] as { metadata?: Record<string, unknown> } | undefined
    const apps = info?.metadata?.['bookmark:applications'] as
      | { 'bookmark:application'?: unknown }
      | undefined
    const list = asArray(apps?.['bookmark:application']) as Record<string, unknown>[]
    return list.length === 1 && list[0]?.[`${ATTR}name`] === this.appName
  }

  /** Return `parent[key]` as a mutable object, creating it if absent. */
  private ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
    const existing = parent[key]
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      return existing as Record<string, unknown>
    }
    const created: Record<string, unknown> = {}
    parent[key] = created
    return created
  }

  /** Ensure our application (and freshened timestamps) sit on an existing bookmark. */
  private attributeToUs(bookmark: Record<string, unknown>, visitedMs: number): Record<string, unknown> {
    const stamp = isoSeconds(visitedMs)
    bookmark[`${ATTR}modified`] = stamp
    bookmark[`${ATTR}visited`] = stamp
    const metadata = this.ensureObject(this.ensureObject(bookmark, 'info'), 'metadata')
    if (!(`${ATTR}owner` in metadata)) metadata[`${ATTR}owner`] = METADATA_OWNER
    if (this.mimeType && !metadata['mime:mime-type']) {
      metadata['mime:mime-type'] = { [`${ATTR}type`]: this.mimeType }
    }
    const container = this.ensureObject(metadata, 'bookmark:applications')
    const list = asArray(container['bookmark:application']) as Record<string, unknown>[]
    const mine = list.find((a) => a[`${ATTR}name`] === this.appName)
    if (mine) {
      mine[`${ATTR}exec`] = `'${this.exec}'`
      mine[`${ATTR}modified`] = stamp
    } else {
      list.push(this.buildApplication(stamp))
    }
    container['bookmark:application'] = list.length === 1 ? list[0] : list
    return bookmark
  }

  /** One `<bookmark:application>` naming this app, as the launcher matches it. */
  private buildApplication(stamp: string): Record<string, string> {
    return {
      [`${ATTR}name`]: this.appName,
      // GtkRecentManager quotes the exec; launchers strip the quotes when matching.
      [`${ATTR}exec`]: `'${this.exec}'`,
      [`${ATTR}modified`]: stamp,
      [`${ATTR}count`]: '1'
    }
  }

  /** Build one XBEL bookmark object for a recent file. */
  private buildBookmark(file: RecentFile, visitedMs: number): Record<string, unknown> {
    const stamp = isoSeconds(visitedMs)
    const metadata: Record<string, unknown> = {
      [`${ATTR}owner`]: METADATA_OWNER,
      'bookmark:applications': { 'bookmark:application': this.buildApplication(stamp) }
    }
    if (this.mimeType) metadata['mime:mime-type'] = { [`${ATTR}type`]: this.mimeType }
    return {
      [`${ATTR}href`]: pathToFileURL(file.path).href,
      [`${ATTR}added`]: stamp,
      [`${ATTR}modified`]: stamp,
      [`${ATTR}visited`]: stamp,
      info: { metadata }
    }
  }

  /** Serialize the bookmark set and replace the store atomically. */
  private write(bookmarks: Record<string, unknown>[]): void {
    const doc = {
      xbel: {
        [`${ATTR}version`]: '1.0',
        [`${ATTR}xmlns:bookmark`]: 'http://www.freedesktop.org/standards/desktop-bookmarks',
        [`${ATTR}xmlns:mime`]: 'http://www.freedesktop.org/standards/shared-mime-info',
        bookmark: bookmarks
      }
    }
    const xml = XML_HEADER + this.builder.build(doc)
    mkdirSync(dirname(this.filePath), { recursive: true })
    // Write-then-rename so a crash mid-write can't truncate a file other apps read.
    const tmp = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(tmp, xml, 'utf8')
    renameSync(tmp, this.filePath)
  }
}
