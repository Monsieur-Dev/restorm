import { describe, it, expect, vi } from 'vitest'
import type { WebContents, MenuItemConstructorOptions } from 'electron'

// toMenuItems doesn't touch Menu/ipcMain (those are used only when registering
// the handlers), so a bare electron mock is enough to import the module.
vi.mock('electron', () => ({ Menu: {}, ipcMain: { handle: vi.fn() } }))

import { toMenuItems } from './nativeMenuHandlers'

const send = vi.fn()
const fakeSender = { isDestroyed: () => false, send } as unknown as WebContents

type Nodes = Parameters<typeof toMenuItems>[0]

/** Map `nodes` and return the single resulting item, asserting there is one. */
const only = (nodes: Nodes): MenuItemConstructorOptions => {
  const items = toMenuItems(nodes, fakeSender)
  expect(items).toHaveLength(1)
  const item = items[0]
  if (!item) throw new Error('expected exactly one item')
  return item
}

describe('toMenuItems', () => {
  it('honours a host-declared role and lets the role own enablement', () => {
    // The in-window MenuBar marks these `disabled` (unwired on Win/Linux), so
    // the template carries enabled:false. On macOS the role must still be
    // active or ⌘C/⌘V/⌘Z would be permanently dead — the exact trap a native
    // Edit menu exists to avoid.
    const copy = only([{ id: 'edit-copy', label: 'Copy', role: 'copy', enabled: false }])
    expect(copy.role).toBe('copy')
    expect(copy.enabled).toBeUndefined()
  })

  it('keeps every standard edit role', () => {
    const roles = ['undo', 'redo', 'cut', 'copy', 'paste'] as const
    for (const role of roles) {
      const item = only([{ id: `edit-${role}`, label: role, role, enabled: false }])
      expect(item.role).toBe(role)
      expect(item.enabled).toBeUndefined()
    }
  })

  it('refuses togglefullscreen even when a host asks for it (AppKit would inject a duplicate)', () => {
    const item = only([{ id: 'view-fullscreen', label: 'Fullscreen', role: 'togglefullscreen' }])
    expect(item.role).toBeUndefined()
    expect(item.click).toBeTypeOf('function')
  })

  it('refuses container roles, which would substitute a generated submenu for the host\'s own', () => {
    // A container role discards the declared submenu and injects Electron's,
    // so the native menu would diverge from the in-window one built from the
    // same JSX — the exact drift deriving both from one tree exists to prevent.
    // `appMenu` would additionally duplicate the one prepended when building.
    for (const role of ['appMenu', 'fileMenu', 'editMenu', 'windowMenu']) {
      const item = only([{ id: `menu-${role}`, label: role, role }])
      expect(item.role, `${role} must not be honoured`).toBeUndefined()
      expect(item.click, `${role} must fall back to a plain action`).toBeTypeOf('function')
    }
  })

  it('disables a non-role item that carries enabled:false', () => {
    const item = only([{ id: 'edit-find', label: 'Find', enabled: false }])
    expect(item.role).toBeUndefined()
    expect(item.enabled).toBe(false)
  })

  it('wires a click that echoes the item id back to the renderer', () => {
    const item = only([{ id: 'custom-action', label: 'Do' }])
    expect(item.role).toBeUndefined()
    ;(item.click as () => void)()
    expect(send).toHaveBeenCalledWith('native-menu:invoke', 'custom-action')
  })

  it('renders a checkbox item and preserves the checked state', () => {
    const item = only([{ id: 'toggle', label: 'On', checked: true }])
    expect(item.type).toBe('checkbox')
    expect(item.checked).toBe(true)
  })

  it('passes a separator through', () => {
    const item = only([{ type: 'separator' }])
    expect(item).toEqual({ type: 'separator' })
  })

  it('recurses into a submenu and keeps a disabled submenu container disabled', () => {
    const menu = only([
      {
        id: 'parent',
        label: 'Parent',
        enabled: false,
        submenu: [{ id: 'edit-copy', label: 'Copy', role: 'copy', enabled: false }]
      }
    ])
    expect(menu.enabled).toBe(false)
    const submenu = menu.submenu as MenuItemConstructorOptions[]
    expect(submenu).toHaveLength(1)
    // The nested role item is still governed by its role, not the parent flag.
    expect(submenu[0]?.role).toBe('copy')
  })
})
