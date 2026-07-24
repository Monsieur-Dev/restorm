// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { buildNativeMenuTemplate, toAccelerator } from './menuTemplate'
import MenuBar from '../components/MenuBar/MenuBar'
import MenuBarItem from '../components/MenuBar/MenuBarItem'
import MenuItem from '../components/MenuBar/MenuItem'
import MenuItemSeparator from '../components/MenuBar/MenuItemSeparator'

describe('toAccelerator', () => {
  it('maps Ctrl to CmdOrCtrl so macOS shows ⌘ and Windows/Linux keep Ctrl', () => {
    expect(toAccelerator('Ctrl+N')).toBe('CmdOrCtrl+N')
    expect(toAccelerator('Ctrl+Shift+S')).toBe('CmdOrCtrl+Shift+S')
  })

  it('returns undefined for missing/blank shortcuts', () => {
    expect(toAccelerator(undefined)).toBeUndefined()
    expect(toAccelerator('   ')).toBeUndefined()
  })
})

describe('buildNativeMenuTemplate — derives the native menu from the SAME JSX', () => {
  it('walks MenuBar > MenuBarItem > MenuItem/Separator into an Electron template', () => {
    const onNew = vi.fn()
    const onOpen = vi.fn()

    const jsx = (
      <MenuBar>
        <MenuBarItem title="File">
          <MenuItem data-testid="mi-new" title="New" shortcut="Ctrl+N" opensDialog onClick={onNew} />
          <MenuItemSeparator />
          <MenuItem data-testid="mi-open" title="Open" shortcut="Ctrl+O" onClick={onOpen} />
        </MenuBarItem>
      </MenuBar>
    )

    const { template, handlers } = buildNativeMenuTemplate(jsx)

    expect(template).toHaveLength(1)
    expect(template[0]?.label).toBe('File')
    const submenu = template[0]?.submenu ?? []
    expect(submenu).toHaveLength(3)

    // `opensDialog` appends the platform-conventional ellipsis
    expect(submenu[0]).toMatchObject({ id: 'mi-new', label: 'New…', accelerator: 'CmdOrCtrl+N' })
    expect(submenu[1]).toEqual({ type: 'separator' })
    expect(submenu[2]).toMatchObject({ id: 'mi-open', label: 'Open', accelerator: 'CmdOrCtrl+O' })

    // The template itself must stay serializable — no functions cross IPC.
    expect(JSON.parse(JSON.stringify(template))).toEqual(template)

    // Handlers stay renderer-side, keyed by the same ids.
    handlers.get('mi-new')?.()
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('honours conditional entries — the case that would silently drift in a hand-written template', () => {
    const build = (fileOpen: boolean): ReturnType<typeof buildNativeMenuTemplate> =>
      buildNativeMenuTemplate(
        <MenuBar>
          <MenuBarItem title="File">
            <MenuItem data-testid="mi-new" title="New" onClick={vi.fn()} />
            {fileOpen && (
              <>
                <MenuItemSeparator />
                <MenuItem data-testid="mi-save" title="Save" shortcut="Ctrl+S" onClick={vi.fn()} />
              </>
            )}
          </MenuBarItem>
        </MenuBar>
      )

    const closed = build(false).template[0]?.submenu ?? []
    expect(closed.map((n) => n.label ?? n.type)).toEqual(['New'])

    const open = build(true).template[0]?.submenu ?? []
    expect(open.map((n) => n.label ?? n.type)).toEqual(['New', 'separator', 'Save'])
  })

  it('propagates disabled and checked, and drops a menu whose items are all hidden', () => {
    const { template } = buildNativeMenuTemplate(
      <MenuBar>
        <MenuBarItem title="View">
          <MenuItem data-testid="mi-a" title="Toggle" checked disabled onClick={vi.fn()} />
        </MenuBarItem>
        <MenuBarItem title="Empty">{null}</MenuBarItem>
      </MenuBar>
    )

    expect(template.map((n) => n.label)).toEqual(['View'])
    expect(template[0]?.submenu?.[0]).toMatchObject({ enabled: false, checked: true })
  })
})
