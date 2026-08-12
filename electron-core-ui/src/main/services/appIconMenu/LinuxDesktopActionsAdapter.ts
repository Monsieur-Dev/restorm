import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../LoggerService'
import { FAVORITES_ENTRY_ID } from '../../../types/appIconMenu'
import type { AppIconMenuAdapter, AppIconMenuModel, AppIconMenuEntry } from '../AppIconMenuService'
import type { AppIconAction } from '../../../types/appIconMenu'

/**
 * Linux favorites, via per-app **`.desktop` actions**.
 *
 * A desktop that lists an app's actions on its task-manager / launcher entry
 * (KDE Plasma, GNOME, docks) reads them from the `.desktop` file's
 * `[Desktop Action …]` groups. Those are normally static, but favorites change
 * at runtime, so this adapter maintains a *user-level* copy of the installed
 * entry at `~/.local/share/applications/<id>` (which shadows the system one)
 * and rewrites its action list from the current favorites. The static "new"
 * action shipped in the package is carried over untouched; each favorite is
 * appended as an action that reopens that file.
 *
 * When there are no favorites the override is removed, falling back to the
 * packaged entry. Everything is best-effort — a missing system entry (a dev
 * run), an unwritable data dir, or any error degrades to leaving the packaged
 * entry in place.
 */

/** Icon every favorite action carries — a themed star, aligned like real icons. */
const DEFAULT_FAVORITE_ICON = 'emblem-favorite'
/** Key that marks the override as ours, so removal never deletes a foreign file. */
const MANAGED_MARKER_KEY = 'X-AppIconMenu-Managed'

/** A favorite file, reduced to what an action needs. */
interface Favorite {
  path: string
  name: string
}

/** Options for {@link LinuxDesktopActionsAdapter}. */
export interface LinuxDesktopActionsAdapterOptions {
  /**
   * The installed `.desktop` file id, e.g. `myapp.desktop`. Defaults to a
   * best-effort guess from the launch environment / app name; injecting the
   * real value is strongly preferred so the override shadows the right entry.
   */
  desktopFileId?: string | undefined
  /** Themed icon name for favorite actions. Defaults to a star emblem. */
  favoriteIcon?: string | undefined
}

/** Escape a value for a `.desktop` key (spec reserves the backslash escapes). */
const desktopValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')

/** Quote a path as a single `Exec` argument, escaping the reserved characters. */
const execArg = (path: string): string => `"${path.replace(/(["`$\\])/g, '\\$1')}"`

/** Derive the `.desktop` id this process was most likely launched from. */
const defaultDesktopFileId = (): string => {
  const launched = process.env['GIO_LAUNCHED_DESKTOP_FILE']
  if (launched) {
    const base = launched.slice(launched.lastIndexOf('/') + 1)
    if (base) return base
  }
  return `${app.getName().toLowerCase()}.desktop`
}

/** User applications dir — where the override lives and shadows the system one. */
const userApplicationsDir = (): string => {
  const dataHome = process.env['XDG_DATA_HOME']
  if (dataHome) return join(dataHome, 'applications')
  return join(homedir(), '.local', 'share', 'applications')
}

/** Pull the favorite entries out of the neutral model. */
const favoritesOf = (model: AppIconMenuModel): Favorite[] => {
  const entry = model.entries.find((e: AppIconMenuEntry) => e.id === FAVORITES_ENTRY_ID)
  if (!entry?.submenu) return []
  const favorites: Favorite[] = []
  for (const child of entry.submenu) {
    if (child.action?.kind === 'open-file') favorites.push({ path: child.action.path, name: child.label })
  }
  return favorites
}

export class LinuxDesktopActionsAdapter implements AppIconMenuAdapter {
  private readonly desktopFileId: string
  private readonly favoriteIcon: string
  private readonly userDir: string
  private readonly overridePath: string
  private available = true

  constructor(options: LinuxDesktopActionsAdapterOptions = {}) {
    this.desktopFileId = options.desktopFileId ?? defaultDesktopFileId()
    this.favoriteIcon = options.favoriteIcon ?? DEFAULT_FAVORITE_ICON
    this.userDir = userApplicationsDir()
    this.overridePath = join(this.userDir, this.desktopFileId)
  }

  public apply(model: AppIconMenuModel, _dispatch: (action: AppIconAction) => void): void {
    // The launcher relaunches the app with the file as an argument; nothing
    // calls back into this process, so `dispatch` has no role here.
    this.sync(favoritesOf(model))
  }

  public clear(): void {
    this.sync([])
  }

  /** Bring the override in line with `favorites`, best-effort. */
  private sync(favorites: Favorite[]): void {
    if (!this.available || process.platform !== 'linux') return
    try {
      if (favorites.length === 0) {
        this.removeOverride()
        return
      }
      const base = this.readSystemEntry()
      // With no packaged entry to shadow (dev run, unusual install) we can't
      // build a faithful override without risking a broken launcher entry.
      if (base === null) return
      this.writeOverride(this.composeOverride(base, favorites))
      this.refreshDatabase()
    } catch (error) {
      logger.error('Failed to sync Linux desktop actions', { error: String(error) })
      this.available = false
    }
  }

  /** Read the packaged entry from the system dirs (never our own override). */
  private readSystemEntry(): string | null {
    const dataDirs = process.env['XDG_DATA_DIRS'] ?? '/usr/local/share:/usr/share'
    const dirs = dataDirs
      .split(':')
      .filter(Boolean)
      .map((dir) => join(dir, 'applications', this.desktopFileId))
    for (const path of dirs) {
      if (path !== this.overridePath && existsSync(path)) return readFileSync(path, 'utf8')
    }
    return null
  }

  /** Build the override text: packaged entry + favorite actions. */
  private composeOverride(base: string, favorites: Favorite[]): string {
    const execBin = this.parseExec(base)
    const favIds = favorites.map((_, i) => `fav${i}`)
    const lines = base.replace(/\n+$/, '').split('\n')

    // Extend the [Desktop Entry] `Actions=` list (before any action group).
    const firstActionGroup = lines.findIndex((l) => l.startsWith('[Desktop Action '))
    const searchEnd = firstActionGroup === -1 ? lines.length : firstActionGroup
    const actionsIdx = lines.findIndex((l, i) => i < searchEnd && l.startsWith('Actions='))
    const existingActionsLine = actionsIdx === -1 ? undefined : lines[actionsIdx]
    const existing = existingActionsLine
      ? existingActionsLine.slice('Actions='.length).split(';').filter(Boolean)
      : []
    const actionsLine = `Actions=${[...existing, ...favIds].join(';')};`
    if (actionsIdx === -1) {
      const entryHeader = lines.findIndex((l) => l.trim() === '[Desktop Entry]')
      lines.splice(entryHeader + 1, 0, actionsLine, `${MANAGED_MARKER_KEY}=true`)
    } else {
      lines[actionsIdx] = actionsLine
      lines.splice(actionsIdx + 1, 0, `${MANAGED_MARKER_KEY}=true`)
    }

    const groups = favorites.map((fav, i) =>
      [
        '',
        `[Desktop Action fav${i}]`,
        `Name=${desktopValue(fav.name)}`,
        `Icon=${this.favoriteIcon}`,
        `Exec=${execBin} ${execArg(fav.path)}`
      ].join('\n')
    )
    return `${lines.join('\n')}\n${groups.join('\n')}\n`
  }

  /** The program from the entry's `Exec`, with field codes (`%U`, …) stripped. */
  private parseExec(base: string): string {
    const line = base.split('\n').find((l) => l.startsWith('Exec='))
    const value = line ? line.slice('Exec='.length) : process.execPath
    return value.replace(/\s*%[a-zA-Z]/g, '').trim()
  }

  /** Write the override atomically into the user applications dir. */
  private writeOverride(content: string): void {
    mkdirSync(this.userDir, { recursive: true })
    const tmp = `${this.overridePath}.${process.pid}.tmp`
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, this.overridePath)
  }

  /** Delete the override, but only when it is the one we generated. */
  private removeOverride(): void {
    if (!existsSync(this.overridePath)) return
    const content = readFileSync(this.overridePath, 'utf8')
    if (!content.includes(`${MANAGED_MARKER_KEY}=true`)) return
    rmSync(this.overridePath, { force: true })
    this.refreshDatabase()
  }

  /** Nudge the desktop's caches to notice the change; failures are ignored. */
  private refreshDatabase(): void {
    try {
      const child = spawn('update-desktop-database', [this.userDir], { stdio: 'ignore' })
      child.on('error', () => {
        // The tool is optional; KDE/GNOME also watch the directory directly.
      })
    } catch {
      // spawn itself can throw if the binary is missing — harmless.
    }
  }
}
