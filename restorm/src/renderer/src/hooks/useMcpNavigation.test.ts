// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useRef } from 'react'

// The real 'electron-core-ui/renderer' barrel drags Monaco into jsdom; this
// hook only needs `navigationService.navigateTo` to exist.
vi.mock('electron-core-ui/renderer', () => ({
  navigationService: { navigateTo: vi.fn() },
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
}))

// Stand in for the preload bridge. Captures the callbacks the hook
// registers so a test can invoke `mcp:open-tab` / `mcp:reveal-in-tree` /
// `mcp:close-tab` directly, exactly as main's IPC broadcast would.
type OpenCb = (payload: { requestId?: string; itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' | 'design' }) => void
type RevealCb = (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' | 'design' }) => void
type CloseCb = (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' | 'design' }) => void

let openCb: OpenCb | null = null
let revealCb: RevealCb | null = null
let closeCb: CloseCb | null = null
const replyMcpOpenTab = vi.fn<(payload: { requestId: string; opened: boolean }) => void>()

const bridge = {
  runtime: {
    onMcpOpenTab: (cb: OpenCb) => { openCb = cb; return () => { openCb = null } },
    onMcpRevealInTree: (cb: RevealCb) => { revealCb = cb; return () => { revealCb = null } },
    onMcpCloseTab: (cb: CloseCb) => { closeCb = cb; return () => { closeCb = null } },
    replyMcpOpenTab
  }
}

;(window as unknown as { restorm: unknown }).restorm = bridge

import { useMcpNavigation, type UseMcpNavigationInput } from './useMcpNavigation'
import type { FolderItem } from '../../../shared/types/collections'

afterEach(() => {
  cleanup()
  openCb = null
  revealCb = null
  closeCb = null
  replyMcpOpenTab.mockReset()
  // Reinstalled rather than left to file-level isolation, so a test that
  // swaps the bridge out can't leak into the next one.
  ;(window as unknown as { restorm: unknown }).restorm = bridge
})

/** Minimal `Request`-shaped item — duck-typed by `isRequest` (has `type`, no `items`). */
function fakeRequest(id: string): FolderItem {
  return { id, name: id, type: 'http' } as unknown as FolderItem
}

/** Minimal `Folder`-shaped item — duck-typed by `isAnyFolder` (has `items` + `configuration`). */
function fakeFolder(id: string, items: FolderItem[]): FolderItem {
  return { id, name: id, items, configuration: {} } as unknown as FolderItem
}

function setup(rootItems: FolderItem[]): { rootItemsRef: { current: FolderItem[] }; input: Omit<UseMcpNavigationInput, 'rootItemsRef'> } {
  const openAnyRequestTab = vi.fn()
  const input: Omit<UseMcpNavigationInput, 'rootItemsRef'> = {
    enabled: true,
    setExpandedIds: vi.fn(),
    setSelectedItemId: vi.fn(),
    openFolderTab: vi.fn(),
    openEnvironmentFolderTab: vi.fn(),
    openAnyRequestTab,
    openScenarioEditorTab: vi.fn(),
    openDesignTab: vi.fn(),
    openRecordingTab: vi.fn(),
    closeTabByItemId: vi.fn()
  }
  const { result } = renderHook(() => {
    const rootItemsRef = useRef<FolderItem[]>(rootItems)
    useMcpNavigation({ ...input, rootItemsRef })
    return rootItemsRef
  })
  return { rootItemsRef: result.current, input }
}

describe('useMcpNavigation — open_tab race fix', () => {
  it('finds an item written into rootItemsRef AFTER mount, with no re-render — proves the effect does not depend on a stale rootItems closure', () => {
    const { rootItemsRef, input } = setup([])
    expect(openCb).not.toBeNull()

    // Simulate `useMcpTreeReplace`'s synchronous ref write on `mcp:tree-replace`
    // — mutated directly, no `rerender()`, no new render of this hook at all.
    rootItemsRef.current = [fakeRequest('r1')]

    openCb?.({ requestId: 'ack-1', itemId: 'r1', kind: 'request' })

    expect(input.openAnyRequestTab).toHaveBeenCalledTimes(1)
    expect((input.openAnyRequestTab as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({ id: 'r1' })
    expect(replyMcpOpenTab).toHaveBeenCalledWith({ requestId: 'ack-1', opened: true })
  })

  it('acks opened:false (never a silent no-op) when the item genuinely is not in the tree', () => {
    const { input } = setup([])
    openCb?.({ requestId: 'ack-2', itemId: 'ghost', kind: 'request' })
    expect(input.openAnyRequestTab).not.toHaveBeenCalled()
    expect(replyMcpOpenTab).toHaveBeenCalledWith({ requestId: 'ack-2', opened: false })
  })

  it('does not ack at all when the payload carries no requestId (the run_request internal sender)', () => {
    const { rootItemsRef, input } = setup([])
    rootItemsRef.current = [fakeRequest('r1')]
    openCb?.({ itemId: 'r1', kind: 'request' })
    expect(input.openAnyRequestTab).toHaveBeenCalledTimes(1)
    expect(replyMcpOpenTab).not.toHaveBeenCalled()
  })

  it('does not throw when the preload bridge lacks replyMcpOpenTab (stale bundle) — the tab still opens, the MCP channel is not wedged', () => {
    // An out-of-date preload can expose a bridge missing newer methods. Calling
    // an absent method would throw and, uncaught in this IPC handler, wedge the
    // whole renderer-bound MCP channel. The handler must guard against it.
    const strippedRuntime = {
      onMcpOpenTab: (cb: OpenCb) => { openCb = cb; return () => { openCb = null } },
      onMcpRevealInTree: (cb: RevealCb) => { revealCb = cb; return () => { revealCb = null } },
      onMcpCloseTab: (cb: CloseCb) => { closeCb = cb; return () => { closeCb = null } }
      // deliberately no replyMcpOpenTab
    }
    ;(window as unknown as { restorm: unknown }).restorm = { runtime: strippedRuntime }

    const { rootItemsRef, input } = setup([])
    rootItemsRef.current = [fakeRequest('r1')]

    expect(() => openCb?.({ requestId: 'ack-stale', itemId: 'r1', kind: 'request' })).not.toThrow()
    // Handler ran to completion instead of wedging on the missing ack.
    expect(input.openAnyRequestTab).toHaveBeenCalledTimes(1)
  })

  it('acks opened:false and does not throw when opening the tab fails mid-handler (no MCP-channel wedge)', () => {
    const { rootItemsRef, input } = setup([])
    rootItemsRef.current = [fakeRequest('r1')]
    ;(input.openAnyRequestTab as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('boom') })

    expect(() => openCb?.({ requestId: 'ack-boom', itemId: 'r1', kind: 'request' })).not.toThrow()
    expect(replyMcpOpenTab).toHaveBeenCalledWith({ requestId: 'ack-boom', opened: false })
  })

  it('reveal_in_tree reads the same live ref written after mount (no stale-tree miss)', () => {
    const { rootItemsRef, input } = setup([])
    // Nested one level so a hit produces a real ancestor to expand —
    // proves `expandAncestors` actually resolved the item against the
    // freshly-written ref rather than silently finding nothing.
    rootItemsRef.current = [fakeFolder('f1', [fakeRequest('r1')])]
    revealCb?.({ itemId: 'r1', kind: 'request' })
    expect(input.setExpandedIds).toHaveBeenCalledTimes(1)
    const updater = (input.setExpandedIds as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as (prev: string[]) => string[]
    expect(updater([])).toEqual(['f1'])
  })

  it('close_tab still delegates directly, unaffected by the ref switch', () => {
    const { input } = setup([])
    closeCb?.({ itemId: 'r1', kind: 'request' })
    expect(input.closeTabByItemId).toHaveBeenCalledWith('r1')
  })
})
