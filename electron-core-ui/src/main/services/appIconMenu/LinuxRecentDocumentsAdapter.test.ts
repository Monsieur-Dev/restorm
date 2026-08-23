import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getName: () => 'TestApp' } }))
vi.mock('../LoggerService', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { LinuxRecentDocumentsAdapter } from './LinuxRecentDocumentsAdapter'
import { NEW_FILE_ENTRY_ID, FAVORITES_ENTRY_ID, RECENT_FILES_ENTRY_ID } from '../../../types/appIconMenu'
import type { AppIconMenuModel } from '../AppIconMenuService'

const FOREIGN_XBEL = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0" xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">
  <bookmark href="file:///other/thing.txt" added="2020-01-01T00:00:00Z" modified="2020-01-01T00:00:00Z" visited="2020-01-01T00:00:00Z">
    <info><metadata owner="http://freedesktop.org">
      <mime:mime-type type="text/plain"/>
      <bookmark:applications><bookmark:application name="OtherApp" exec="'other %u'" modified="2020-01-01T00:00:00Z" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>
</xbel>`

// A bookmark for one of OUR recents, written by another writer (e.g. the GTK
// portal) with only its own generic application attributed.
const PORTAL_XBEL = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0" xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">
  <bookmark href="file:///home/u/a.app" added="2020-01-01T00:00:00Z" modified="2020-01-01T00:00:00Z" visited="2020-01-01T00:00:00Z">
    <info><metadata owner="http://freedesktop.org">
      <bookmark:applications><bookmark:application name="xdg-desktop-portal-gtk" exec="'gio open %u'" modified="2020-01-01T00:00:00Z" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>
</xbel>`

const model = (): AppIconMenuModel => ({
  entries: [
    { id: NEW_FILE_ENTRY_ID, label: 'New', enabled: true, action: { kind: 'new-file' } },
    {
      id: FAVORITES_ENTRY_ID,
      label: 'Favorites',
      enabled: true,
      submenu: [{ id: 'f', label: 'fav', enabled: true, action: { kind: 'open-file', path: '/home/u/favx.app' } }]
    },
    {
      id: RECENT_FILES_ENTRY_ID,
      label: 'Recent',
      enabled: true,
      submenu: [
        { id: 'r1', label: 'a.app', enabled: true, action: { kind: 'open-file', path: '/home/u/a.app' } },
        { id: 'r2', label: 'b.app', enabled: true, action: { kind: 'open-file', path: '/home/u/b.app' } }
      ]
    }
  ]
})

describe('LinuxRecentDocumentsAdapter', () => {
  let dataHome: string
  let prev: string | undefined
  const xbel = (): string => readFileSync(join(dataHome, 'recently-used.xbel'), 'utf8')
  const makeAdapter = (): LinuxRecentDocumentsAdapter =>
    new LinuxRecentDocumentsAdapter({ appName: 'TestApp', exec: '/opt/TestApp/bin %U', mimeType: 'application/x-test' })

  beforeEach(() => {
    dataHome = mkdtempSync(join(tmpdir(), 'ecui-xbel-'))
    prev = process.env['XDG_DATA_HOME']
    process.env['XDG_DATA_HOME'] = dataHome
  })
  afterEach(() => {
    if (prev === undefined) delete process.env['XDG_DATA_HOME']
    else process.env['XDG_DATA_HOME'] = prev
    rmSync(dataHome, { recursive: true, force: true })
  })

  it('writes the recent files as XBEL bookmarks tagged with the app', () => {
    makeAdapter().apply(model(), () => undefined)
    const out = xbel()
    expect(out).toContain('file:///home/u/a.app')
    expect(out).toContain('file:///home/u/b.app')
    expect(out).toContain('name="TestApp"')
    expect(out).toContain('type="application/x-test"')
  })

  it('leaves favorites out of the recent-documents store', () => {
    makeAdapter().apply(model(), () => undefined)
    expect(xbel()).not.toContain('favx.app')
  })

  it('preserves bookmarks that belong to other applications', () => {
    writeFileSync(join(dataHome, 'recently-used.xbel'), FOREIGN_XBEL)
    makeAdapter().apply(model(), () => undefined)
    const out = xbel()
    expect(out).toContain('file:///other/thing.txt')
    expect(out).toContain('name="OtherApp"')
    expect(out).toContain('file:///home/u/a.app')
  })

  it('derives the exec from the installed .desktop so it matches the launcher', () => {
    const sysDir = mkdtempSync(join(tmpdir(), 'ecui-sys-'))
    mkdirSync(join(sysDir, 'applications'), { recursive: true })
    writeFileSync(join(sysDir, 'applications', 'app.desktop'), '[Desktop Entry]\nExec=/opt/Wrapper/app %U\n')
    const prevDirs = process.env['XDG_DATA_DIRS']
    process.env['XDG_DATA_DIRS'] = sysDir
    try {
      new LinuxRecentDocumentsAdapter({
        appName: 'TestApp',
        desktopFileId: 'app.desktop',
        mimeType: 'application/x-test'
      }).apply(model(), () => undefined)
      // the launcher-facing exec comes from the .desktop, not process.execPath
      expect(xbel()).toContain('/opt/Wrapper/app %U')
    } finally {
      if (prevDirs === undefined) delete process.env['XDG_DATA_DIRS']
      else process.env['XDG_DATA_DIRS'] = prevDirs
      rmSync(sysDir, { recursive: true, force: true })
    }
  })

  it('merges our attribution onto a bookmark another writer made for our file', () => {
    writeFileSync(join(dataHome, 'recently-used.xbel'), PORTAL_XBEL)
    makeAdapter().apply(model(), () => undefined)
    const out = xbel()
    // the other writer's application is kept AND ours is added on the same entry
    expect(out).toContain('name="xdg-desktop-portal-gtk"')
    expect(out).toContain('name="TestApp"')
    // still exactly one bookmark for that file — merged, not duplicated
    expect(out.match(/href="file:\/\/\/home\/u\/a\.app"/g)?.length).toBe(1)
  })

  it('clear() drops our entries but keeps foreign ones', () => {
    writeFileSync(join(dataHome, 'recently-used.xbel'), FOREIGN_XBEL)
    const adapter = makeAdapter()
    adapter.apply(model(), () => undefined)
    adapter.clear()
    const out = xbel()
    expect(out).toContain('file:///other/thing.txt')
    expect(out).not.toContain('file:///home/u/a.app')
  })
})
