// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// The real `electron-core-ui/renderer` barrel pulls in Monaco/CSS that the
// test env can't handle, so it is mocked — but deliberately mocked to the
// REAL primitive module rather than a stub. The property under test is that
// the header hook and the library's own popovers share ONE announce
// channel: a stub would make this test pass even if they had drifted onto
// separate channels, which is the exact failure it exists to catch.
vi.mock('electron-core-ui/renderer', async () => {
  const actual = await import('../../../../../electron-core-ui/src/renderer/hooks/useExclusivePopover')
  return { useExclusivePopover: actual.useExclusivePopover }
})

const { useExclusivePopover } = await import('electron-core-ui/renderer')
const { useExclusiveHeaderPopover } = await import('./useExclusiveHeaderPopover')

afterEach(() => { cleanup() })

describe('useExclusiveHeaderPopover', () => {
  it('closes a sibling header popover when a second one opens', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()

    const { rerender: rerenderA } = renderHook(
      ({ open }) => { useExclusiveHeaderPopover(open, closeA) },
      { initialProps: { open: false } }
    )
    const { rerender: rerenderB } = renderHook(
      ({ open }) => { useExclusiveHeaderPopover(open, closeB) },
      { initialProps: { open: false } }
    )

    act(() => { rerenderA({ open: true }) })
    expect(closeA).not.toHaveBeenCalled()

    act(() => { rerenderB({ open: true }) })
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('is mutually exclusive with a library popover in both directions', () => {
    // The header row mixes application popovers (env, auth, quick-config)
    // with library ones that own their state internally (the bookmark/tag
    // ribbon editors, the icon picker). They only form a single set if both
    // sides announce on the same channel.
    const closeHeader = vi.fn()
    const closeLibrary = vi.fn()

    const { rerender: rerenderHeader } = renderHook(
      ({ open }) => { useExclusiveHeaderPopover(open, closeHeader) },
      { initialProps: { open: false } }
    )
    const { rerender: rerenderLibrary } = renderHook(
      ({ open }) => { useExclusivePopover(open, closeLibrary) },
      { initialProps: { open: false } }
    )

    // library popover open → header popover opens → library one closes
    act(() => { rerenderLibrary({ open: true }) })
    act(() => { rerenderHeader({ open: true }) })
    expect(closeLibrary).toHaveBeenCalledTimes(1)

    // Reverse direction. `close` here is a spy, so unlike a real component
    // it does not drive the `open` prop back down — the announce effect is
    // keyed on `open`, so re-rendering it still-true would be inert. Flip
    // it down and up to model what the real popover's state does.
    act(() => { rerenderLibrary({ open: false }) })
    act(() => { rerenderLibrary({ open: true }) })
    expect(closeHeader).toHaveBeenCalledTimes(1)
  })
})
