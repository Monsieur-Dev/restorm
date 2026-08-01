// @vitest-environment jsdom
/**
 * On a project load the favourites memo runs before `rootItems` is populated,
 * so every stored favourite id resolved to nothing: the pane rendered empty for
 * a beat and the log claimed each id was dangling. The stored ids are never
 * touched by this pass, so nothing is lost — but on a slow load the empty pane
 * is what the user sees, and the log sends anyone debugging it down the wrong
 * path. Resolution has to wait for the tree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { FolderItem } from '../../../shared/types/collections'

const debug = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key })
}))

vi.mock('electron-core-ui/renderer', () => ({
  isContainerNode: (node: object) => 'groups' in node,
  isTabGroupNode: (node: object) => 'tabs' in node,
  logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../services/FolderToListView', () => ({
  folderItemToListViewItem: (item: { id: string; name: string }) => ({ id: item.id, label: item.name })
}))

vi.mock('../components/MainView/Sidebar/contextMenuBuilder', () => ({
  buildFavoritesContextMenuForItem: () => [],
  buildOpenDocumentsContextMenuForItem: () => []
}))

const favorites = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock('../services/favoritesStore', () => ({ getFavorites: () => favorites.ids }))

import { useFavoritesAndOpenItems } from './useFavoritesAndOpenItems'

const REQUEST: FolderItem = { id: 'req-1', name: 'List pets', type: 'http' } as unknown as FolderItem

function renderFavorites(rootItems: FolderItem[]): { favoriteItems: { id: string }[] } {
  const { result } = renderHook(() =>
    useFavoritesAndOpenItems({
      rootItems,
      workbenchTree: { groups: [] } as never,
      projectUuid: 'project-1',
      isItemFavorite: () => true,
      onRenameFavoriteItem: vi.fn(),
      onRenameOpenedItem: vi.fn(),
      onCloneItem: vi.fn(),
      onDeleteItem: vi.fn(),
      onToggleFavorite: vi.fn(),
      onUnfavorite: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseOtherTabs: vi.fn(),
      onCloseTabsToTheRight: vi.fn(),
      onCloseAllTabs: vi.fn()
    })
  )
  return result.current as { favoriteItems: { id: string }[] }
}

beforeEach(() => {
  favorites.ids = []
  debug.mockClear()
})

describe('favourite resolution during a project load', () => {
  it('does not report a favourite as unknown while the tree is still empty', () => {
    favorites.ids = ['req-1']
    renderFavorites([])
    expect(debug).not.toHaveBeenCalled()
  })

  it('resolves the favourite once the tree has loaded', () => {
    favorites.ids = ['req-1']
    const { favoriteItems } = renderFavorites([REQUEST])
    expect(favoriteItems.map((r) => r.id)).toEqual(['req-1'])
    expect(debug).not.toHaveBeenCalled()
  })

  it('still reports a genuinely dangling favourite against a loaded tree', () => {
    // A stale persistence file — the tree IS loaded and the id is not in it.
    favorites.ids = ['ghost']
    const { favoriteItems } = renderFavorites([REQUEST])
    expect(favoriteItems).toEqual([])
    expect(debug).toHaveBeenCalledWith(
      'Favorite id refers to an unknown item — skipping',
      { id: 'ghost' }
    )
  })

  it('renders nothing, quietly, for a project with no favourites', () => {
    favorites.ids = []
    const { favoriteItems } = renderFavorites([])
    expect(favoriteItems).toEqual([])
    expect(debug).not.toHaveBeenCalled()
  })
})
