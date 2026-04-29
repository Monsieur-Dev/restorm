import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerOpenContextMenu,
  __resetOpenContextMenuRegistryForTesting,
  __seedOpenContextMenuRegistryForTesting
} from './openContextMenuRegistry'

describe('openContextMenuRegistry', () => {
  beforeEach(() => {
    __resetOpenContextMenuRegistryForTesting()
  })

  it('does not call any close fn when only one menu is registered', () => {
    const closeA = vi.fn()
    registerOpenContextMenu(closeA)
    expect(closeA).not.toHaveBeenCalled()
  })

  it('closes the previously-registered menu when a new one registers', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    registerOpenContextMenu(closeA)
    registerOpenContextMenu(closeB)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('closes every concurrent menu when a new one registers, not just the most recent', () => {
    // Seed two entries directly into the registry, mimicking a
    // racy state. The third register call must close *both*, not
    // just one — the iteration is over the live set, not a single
    // most-recent slot.
    const closeA = vi.fn()
    const closeB = vi.fn()
    __seedOpenContextMenuRegistryForTesting(closeA)
    __seedOpenContextMenuRegistryForTesting(closeB)

    const closeC = vi.fn()
    registerOpenContextMenu(closeC)
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).toHaveBeenCalledTimes(1)
    expect(closeC).not.toHaveBeenCalled()
  })

  it('survives a synchronous deregister inside a `close` callback', () => {
    // If `closeOther()` synchronously triggers the React effect's
    // cleanup which calls the deregister fn, the iteration must
    // still finish without throwing or skipping subsequent entries.
    let deregisterA: (() => void) | null = null
    const closeA = vi.fn(() => {
      deregisterA?.()
    })
    deregisterA = registerOpenContextMenu(closeA)

    const closeB = vi.fn()
    expect(() => registerOpenContextMenu(closeB)).not.toThrow()
    expect(closeA).toHaveBeenCalledTimes(1)
  })

  it('returns a deregister fn that removes the entry from the registry', () => {
    const closeA = vi.fn()
    const deregisterA = registerOpenContextMenu(closeA)
    deregisterA()

    const closeB = vi.fn()
    registerOpenContextMenu(closeB)
    // A was already deregistered, so opening B must not invoke A's close.
    expect(closeA).not.toHaveBeenCalled()
  })

  it('is idempotent if the same close fn registers twice (re-render of the same menu)', () => {
    const closeA = vi.fn()
    registerOpenContextMenu(closeA)
    registerOpenContextMenu(closeA)
    // A registering itself again must not call its own close — the
    // menu is still visible, just re-rendered.
    expect(closeA).not.toHaveBeenCalled()
  })

  it('does not call the just-registered fn when it closes others', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()
    registerOpenContextMenu(closeA)
    registerOpenContextMenu(closeB)
    // B should never close itself even though it iterates the registry.
    expect(closeB).not.toHaveBeenCalled()
  })
})
