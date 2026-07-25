import { describe, it, expect, vi } from 'vitest'
import { buildEmptyAreaContextMenu, type SidebarContextMenuItem } from './contextMenuBuilder'

const t = (key: string): string => key

/** The empty-area menu is a single "Add" submenu — return its nested items. */
const addSubmenuItems = (menu: SidebarContextMenuItem[]): SidebarContextMenuItem[] => {
  const root = menu[0]
  if (!root) throw new Error('expected a root menu entry')
  return root.items ?? []
}

describe('buildEmptyAreaContextMenu', () => {
  it('exposes a single "Add" submenu with no redundant top-level create entries', () => {
    const menu = buildEmptyAreaContextMenu(t, vi.fn(), vi.fn())
    expect(menu).toHaveLength(1)
    expect(menu[0]?.id).toBe('add-root-child')
    expect(menu[0]?.label).toBe('sidebar.contextMenu.add.title')
    // The former first-level "Create folder" / "Create environment folder"
    // entries no longer exist — every creation lives under "Add".
    const ids = menu.map((entry) => entry.id)
    expect(ids).not.toContain('create-folder')
    expect(ids).not.toContain('create-env-folder')
  })

  it('slots the environment-folder entry right after Folder with the folder-library icon', () => {
    const items = addSubmenuItems(buildEmptyAreaContextMenu(t, vi.fn(), vi.fn()))
    const folderIndex = items.findIndex((entry) => entry.id.startsWith('add-folder-'))
    expect(folderIndex).toBeGreaterThanOrEqual(0)
    const envEntry = items[folderIndex + 1]
    expect(envEntry?.id).toBe('add-env-folder')
    expect(envEntry?.icon).toBe('folder-library')
    expect(envEntry?.label).toBe('sidebar.contextMenu.add.environmentFolder')
  })

  it('keeps both actions functional: Folder → add-child at root, env-folder → its handler', () => {
    const onAddChildItem = vi.fn()
    const onCreateEnvironmentFolder = vi.fn()
    const items = addSubmenuItems(buildEmptyAreaContextMenu(t, onAddChildItem, onCreateEnvironmentFolder))

    items.find((entry) => entry.id.startsWith('add-folder-'))?.onClick?.()
    expect(onAddChildItem).toHaveBeenCalledWith('', 'folder')

    items.find((entry) => entry.id === 'add-env-folder')?.onClick?.()
    expect(onCreateEnvironmentFolder).toHaveBeenCalledTimes(1)
  })
})
