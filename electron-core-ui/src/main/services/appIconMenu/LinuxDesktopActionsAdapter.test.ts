import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getName: () => 'TestApp' } }))
vi.mock('../LoggerService', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
// The refresh nudge shells out; stub it so tests never spawn a real process.
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => new EventEmitter()) }))

import { LinuxDesktopActionsAdapter } from './LinuxDesktopActionsAdapter'
import { FAVORITES_ENTRY_ID, RECENT_FILES_ENTRY_ID } from '../../../types/appIconMenu'
import type { AppIconMenuModel } from '../AppIconMenuService'

const SYSTEM_ENTRY = `[Desktop Entry]
Name=TestApp
Exec=/opt/TestApp/testapp-bin %U
Icon=testapp
Type=Application
StartupWMClass=testapp
MimeType=application/x-test;
Actions=new;

[Desktop Action new]
Name=New
Icon=document-new
Exec=/opt/TestApp/testapp-bin --new
`

const withFavorites = (favorites: { path: string; name: string }[]): AppIconMenuModel => ({
  entries: [
    {
      id: FAVORITES_ENTRY_ID,
      label: 'Favorites',
      enabled: true,
      submenu: favorites.map((f, i) => ({
        id: `fav${i}`,
        label: f.name,
        enabled: true,
        action: { kind: 'open-file', path: f.path } as const
      }))
    }
  ]
})

const noFavorites = (): AppIconMenuModel => ({
  entries: [
    { id: RECENT_FILES_ENTRY_ID, label: 'Recent', enabled: true, submenu: [{ id: 'r', label: 'a', enabled: true, action: { kind: 'open-file', path: '/a' } }] }
  ]
})

describe('LinuxDesktopActionsAdapter', () => {
  let dataHome: string
  let sysDir: string
  let prevHome: string | undefined
  let prevDirs: string | undefined
  const overridePath = (): string => join(dataHome, 'applications', 'testapp.desktop')
  const makeAdapter = (): LinuxDesktopActionsAdapter =>
    new LinuxDesktopActionsAdapter({ desktopFileId: 'testapp.desktop' })

  beforeEach(() => {
    dataHome = mkdtempSync(join(tmpdir(), 'ecui-userdata-'))
    sysDir = mkdtempSync(join(tmpdir(), 'ecui-sysdata-'))
    mkdirSync(join(sysDir, 'applications'), { recursive: true })
    writeFileSync(join(sysDir, 'applications', 'testapp.desktop'), SYSTEM_ENTRY)
    prevHome = process.env['XDG_DATA_HOME']
    prevDirs = process.env['XDG_DATA_DIRS']
    process.env['XDG_DATA_HOME'] = dataHome
    process.env['XDG_DATA_DIRS'] = sysDir
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env['XDG_DATA_HOME']
    else process.env['XDG_DATA_HOME'] = prevHome
    if (prevDirs === undefined) delete process.env['XDG_DATA_DIRS']
    else process.env['XDG_DATA_DIRS'] = prevDirs
    rmSync(dataHome, { recursive: true, force: true })
    rmSync(sysDir, { recursive: true, force: true })
  })

  it('writes a user override that appends favorites to the packaged actions', () => {
    makeAdapter().apply(withFavorites([{ path: '/home/u/proj.restorm', name: 'proj' }]), () => undefined)
    const out = readFileSync(overridePath(), 'utf8')
    expect(out).toContain('Actions=new;fav0;')
    expect(out).toContain('[Desktop Action fav0]')
    expect(out).toContain('Name=proj')
    expect(out).toContain('Icon=emblem-favorite')
    expect(out).toContain('Exec=/opt/TestApp/testapp-bin "/home/u/proj.restorm"')
    // packaged fields + the static "new" action are carried over untouched
    expect(out).toContain('StartupWMClass=testapp')
    expect(out).toContain('[Desktop Action new]')
    // and it is stamped as ours
    expect(out).toContain('X-AppIconMenu-Managed=true')
  })

  it('removes its own override when there are no favorites', () => {
    const adapter = makeAdapter()
    adapter.apply(withFavorites([{ path: '/p.restorm', name: 'p' }]), () => undefined)
    expect(existsSync(overridePath())).toBe(true)
    adapter.apply(noFavorites(), () => undefined)
    expect(existsSync(overridePath())).toBe(false)
  })

  it('never deletes a foreign override it did not write', () => {
    mkdirSync(join(dataHome, 'applications'), { recursive: true })
    writeFileSync(overridePath(), '[Desktop Entry]\nName=Hand written\n')
    makeAdapter().apply(noFavorites(), () => undefined)
    expect(existsSync(overridePath())).toBe(true)
    expect(readFileSync(overridePath(), 'utf8')).toContain('Hand written')
  })
})
