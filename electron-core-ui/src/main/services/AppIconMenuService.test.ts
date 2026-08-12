import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { JumpListCategory } from 'electron'

// Stub electron + the LoggerService: the module imports `app`/`Menu` for its
// macOS adapter, which the service tests never exercise (they inject a fake
// adapter), and LoggerService reads `app.isPackaged` at module init. The
// Windows adapter is driven directly, so `setJumpList` is hoisted out of the
// factory to stay observable — and callable — on its own.
const { setJumpList } = vi.hoisted(() => ({
  setJumpList: vi.fn<(categories: JumpListCategory[] | null) => void>()
}))
vi.mock('electron', () => ({
  app: { dock: undefined, setJumpList },
  Menu: { buildFromTemplate: vi.fn() }
}))
vi.mock('./LoggerService', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import {
  AppIconMenuService,
  WindowsJumpListAdapter,
  type AppIconAction,
  type AppIconMenuAdapter,
  type AppIconMenuModel
} from './AppIconMenuService'
import type { FileService } from './FileService'
import type { FileMetadata } from '../../types/file'

// ── Fakes ────────────────────────────────────────────────────────────

const meta = (name: string, path: string, isFavorite = false): FileMetadata => ({
  path,
  name,
  lastOpened: 0,
  isFavorite
})

interface FakeFileService {
  service: FileService
  newFile: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  setRecent: (files: FileMetadata[]) => void
  emitStateChange: () => void
}

function makeFakeFileService(recent: FileMetadata[] = []): FakeFileService {
  let files = recent
  const listeners = new Set<() => void>()
  const newFile = vi.fn(() => Promise.resolve(true))
  const open = vi.fn(() => Promise.resolve({ success: true }))

  const service: Partial<FileService> = {
    getRecentFiles: (() => files) as FileService['getRecentFiles'],
    getFavorites: (() => files.filter((f) => f.isFavorite)) as FileService['getFavorites'],
    onStateChanged: ((callback: () => void) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    }) as FileService['onStateChanged'],
    newFile: newFile as unknown as FileService['newFile'],
    open: open as unknown as FileService['open']
  }

  return {
    service: service as FileService,
    newFile,
    open,
    setRecent: (next) => {
      files = next
    },
    emitStateChange: () => {
      listeners.forEach((listener) => {
        listener()
      })
    }
  }
}

interface FakeAdapter extends AppIconMenuAdapter {
  applied: AppIconMenuModel | null
  applyCount: number
  clearCount: number
  dispatch: ((action: AppIconAction) => void) | null
}

function makeFakeAdapter(): FakeAdapter {
  return {
    applied: null,
    applyCount: 0,
    clearCount: 0,
    dispatch: null,
    apply(model, dispatch) {
      this.applied = model
      this.applyCount += 1
      this.dispatch = dispatch
    },
    clear() {
      this.applied = null
      this.clearCount += 1
    }
  }
}

const LABELS = { newFile: 'New', recentFiles: 'Recent files', favorites: 'Favorites' }

// ── Tests ────────────────────────────────────────────────────────────

describe('AppIconMenuService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing until the host has pushed its labels', () => {
    const files = makeFakeFileService([meta('Project', '/tmp/project.json')])
    const adapter = makeFakeAdapter()
    const service = new AppIconMenuService({ fileService: files.service, adapter })

    service.start()

    // Labels come from the renderer, the only process holding every locale;
    // an untranslated menu would be worse than none.
    expect(service.buildModel()).toBeNull()
    expect(adapter.applyCount).toBe(0)
    expect(adapter.clearCount).toBe(1)
  })

  it('offers only the new-file entry when there is no file history', () => {
    const files = makeFakeFileService([])
    const adapter = makeFakeAdapter()
    const service = new AppIconMenuService({ fileService: files.service, adapter })
    service.start()

    service.setLabels(LABELS)

    const model = adapter.applied
    expect(model?.entries).toHaveLength(1)
    expect(model?.entries[0]).toMatchObject({
      id: 'new-file',
      label: 'New',
      enabled: true,
      action: { kind: 'new-file' }
    })
    // An empty submenu reads as a broken menu, so the whole entry is omitted.
    expect(model?.entries[0]?.submenu).toBeUndefined()
  })

  it('lists new file, then favorites, then recents', () => {
    const files = makeFakeFileService([
      meta('Alpha', '/tmp/alpha.json'),
      meta('Beta', '/tmp/beta.json', true)
    ])
    const adapter = makeFakeAdapter()
    const service = new AppIconMenuService({ fileService: files.service, adapter })
    service.start()

    service.setLabels(LABELS)

    const entries = adapter.applied?.entries ?? []
    expect(entries.map((e) => e.id)).toEqual(['new-file', 'favorites', 'recent-files'])
    expect(entries[1]?.label).toBe('Favorites')
    expect(entries[1]?.submenu).toEqual([
      { id: 'favorite:/tmp/beta.json', label: 'Beta', enabled: true, action: { kind: 'open-file', path: '/tmp/beta.json' } }
    ])
    expect(entries[2]?.label).toBe('Recent files')
    expect(entries[2]?.submenu).toEqual([
      { id: 'recent:/tmp/alpha.json', label: 'Alpha', enabled: true, action: { kind: 'open-file', path: '/tmp/alpha.json' } },
      { id: 'recent:/tmp/beta.json', label: 'Beta', enabled: true, action: { kind: 'open-file', path: '/tmp/beta.json' } }
    ])
  })

  it('omits the favorites entry while no file is starred', () => {
    const files = makeFakeFileService([meta('Alpha', '/tmp/alpha.json')])
    const adapter = makeFakeAdapter()
    const service = new AppIconMenuService({ fileService: files.service, adapter })
    service.start()

    service.setLabels(LABELS)

    expect((adapter.applied?.entries ?? []).map((e) => e.id)).toEqual(['new-file', 'recent-files'])
  })

  it('routes activations back to the file service', () => {
    const files = makeFakeFileService([])
    const adapter = makeFakeAdapter()
    const service = new AppIconMenuService({ fileService: files.service, adapter })
    service.start()
    service.setLabels(LABELS)

    service.dispatch({ kind: 'new-file' })
    expect(files.newFile).toHaveBeenCalledTimes(1)

    service.dispatch({ kind: 'open-file', path: '/tmp/alpha.json' })
    expect(files.open).toHaveBeenCalledWith('/tmp/alpha.json')

    // The adapter gets the same routing, so a click on a rendered entry lands
    // in the file service too.
    adapter.dispatch?.({ kind: 'new-file' })
    expect(files.newFile).toHaveBeenCalledTimes(2)
  })

  it('lets a host take over activation while keeping a direct escape hatch', () => {
    const files = makeFakeFileService([])
    const adapter = makeFakeAdapter()
    const hostDispatch = vi.fn()
    const service = new AppIconMenuService({ fileService: files.service, adapter, dispatch: hostDispatch })
    service.start()
    service.setLabels(LABELS)

    // With a host dispatch injected, activation goes to the host — not the file
    // service — so it can run its own guarded command.
    service.dispatch({ kind: 'new-file' })
    expect(hostDispatch).toHaveBeenCalledWith({ kind: 'new-file' })
    expect(files.newFile).not.toHaveBeenCalled()

    // The direct path stays reachable for the host's no-window fallback, and
    // does NOT loop back through the injected dispatch.
    service.dispatchDirect({ kind: 'open-file', path: '/tmp/alpha.json' })
    expect(files.open).toHaveBeenCalledWith('/tmp/alpha.json')
    expect(hostDispatch).toHaveBeenCalledTimes(1)
  })

  it('follows the file state, coalescing a burst of changes into one render', () => {
    const files = makeFakeFileService([])
    const adapter = makeFakeAdapter()
    const service = new AppIconMenuService({ fileService: files.service, adapter, rebuildDebounceMs: 50 })
    service.start()
    service.setLabels(LABELS)
    const rendersBefore = adapter.applyCount

    files.setRecent([meta('Alpha', '/tmp/alpha.json')])
    files.emitStateChange()
    files.emitStateChange()
    expect(adapter.applyCount).toBe(rendersBefore)

    vi.advanceTimersByTime(50)

    expect(adapter.applyCount).toBe(rendersBefore + 1)
    expect((adapter.applied?.entries ?? []).map((e) => e.id)).toEqual(['new-file', 'recent-files'])
  })

  it('stops listening and clears the menu once disposed', () => {
    const files = makeFakeFileService([])
    const adapter = makeFakeAdapter()
    const service = new AppIconMenuService({ fileService: files.service, adapter, rebuildDebounceMs: 50 })
    service.start()
    service.setLabels(LABELS)

    service.dispose()
    const rendersAfterDispose = adapter.applyCount
    files.emitStateChange()
    vi.advanceTimersByTime(50)

    expect(adapter.applyCount).toBe(rendersAfterDispose)
    expect(adapter.applied).toBeNull()
  })
})

describe('WindowsJumpListAdapter', () => {
  const realPlatform = process.platform

  // The adapter refuses to touch the jump list off Windows, so the platform is
  // forced for the duration — the tests run on whatever host CI provides.
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    setJumpList.mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  const MODEL: AppIconMenuModel = {
    entries: [
      { id: 'new-file', label: 'New', enabled: true, action: { kind: 'new-file' } },
      {
        id: 'recent-files',
        label: 'Recent files',
        enabled: true,
        submenu: [
          { id: 'recent:/tmp/alpha.json', label: 'Alpha', enabled: true, action: { kind: 'open-file', path: '/tmp/alpha.json' } },
          { id: 'recent:/tmp/my project.json', label: 'My project', enabled: true, action: { kind: 'open-file', path: '/tmp/my project.json' } }
        ]
      },
      {
        id: 'favorites',
        label: 'Favorites',
        enabled: true,
        submenu: [
          { id: 'favorite:/tmp/beta.json', label: 'Beta', enabled: true, action: { kind: 'open-file', path: '/tmp/beta.json' } }
        ]
      }
    ]
  }

  const applied = (): JumpListCategory[] => setJumpList.mock.calls[0]?.[0] ?? []

  it('records the new-file action as a relaunch flag in the tasks category', () => {
    new WindowsJumpListAdapter().apply(MODEL, vi.fn())

    const tasks = applied().find((category) => category.type === 'tasks')
    expect(tasks?.items).toEqual([
      { type: 'task', program: process.execPath, args: '--new', title: 'New', description: 'New' }
    ])
  })

  it('turns each submenu into a custom category of file relaunches', () => {
    new WindowsJumpListAdapter().apply(MODEL, vi.fn())

    const custom = applied().filter((category) => category.type === 'custom')
    expect(custom.map((category) => category.name)).toEqual(['Recent files', 'Favorites'])
    // The path is quoted so a name containing spaces survives argv splitting.
    expect(custom[0]?.items).toEqual([
      { type: 'task', program: process.execPath, args: '"/tmp/alpha.json"', title: 'Alpha', description: '/tmp/alpha.json' },
      { type: 'task', program: process.execPath, args: '"/tmp/my project.json"', title: 'My project', description: '/tmp/my project.json' }
    ])
    expect(custom[1]?.items).toEqual([
      { type: 'task', program: process.execPath, args: '"/tmp/beta.json"', title: 'Beta', description: '/tmp/beta.json' }
    ])
  })

  it('ignores the dispatch callback — the OS relaunches instead of calling back', () => {
    const dispatch = vi.fn()

    new WindowsJumpListAdapter().apply(MODEL, dispatch)

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('drops the whole jump list on clear', () => {
    new WindowsJumpListAdapter().clear()

    expect(setJumpList).toHaveBeenCalledWith(null)
  })

  it('survives a jump list the shell refuses', () => {
    setJumpList.mockImplementation(() => {
      throw new Error('Failed to set the jump list')
    })

    expect(() => {
      new WindowsJumpListAdapter().apply(MODEL, vi.fn())
    }).not.toThrow()
  })

  it('leaves the jump list alone off Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const adapter = new WindowsJumpListAdapter()
    adapter.apply(MODEL, vi.fn())
    adapter.clear()

    expect(setJumpList).not.toHaveBeenCalled()
  })
})
