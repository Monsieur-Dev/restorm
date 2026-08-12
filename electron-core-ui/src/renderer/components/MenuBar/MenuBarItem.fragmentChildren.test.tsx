// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { MenuBar } from './MenuBar'
import { MenuBarItem } from './MenuBarItem'
import { MenuItem } from './MenuItem'

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    }
  }
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = this.hasAttribute('data-mirror-index') ? 60 : 1000
    return { width, height: 30, top: 0, left: 0, right: width, bottom: 30, x: 0, y: 0, toJSON() { return {} } }
  }
})

afterEach(() => { cleanup() })

/**
 * A conditional group of menu entries (`{cond && (<>…</>)}`) reaches the
 * dropdown's child-cloning pass as a React.Fragment. Fragments accept no
 * prop beyond key/children, so stamping the fallback `data-testid` on one
 * makes React warn "Invalid prop `data-testid` supplied to `React.Fragment`"
 * on every open. The clone pass must pass fragments through untouched while
 * still rendering their inner items.
 */
describe('MenuBarItem with Fragment children', () => {
  it('opens without a React invalid-prop warning and renders the fragment items', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { getByTestId } = render(
      <MenuBar data-testid="mb">
        <MenuBarItem data-testid="mb-edit" title="Edit">
          <MenuItem data-testid="mb-edit-direct" title="Direct" onClick={() => undefined} />
          <>
            <MenuItem data-testid="mb-edit-frag-a" title="Fragment A" onClick={() => undefined} />
            <MenuItem data-testid="mb-edit-frag-b" title="Fragment B" onClick={() => undefined} />
          </>
        </MenuBarItem>
      </MenuBar>
    )

    fireEvent.click(getByTestId('mb-edit'))

    expect(getByTestId('mb-edit-direct')).toBeTruthy()
    expect(getByTestId('mb-edit-frag-a')).toBeTruthy()
    expect(getByTestId('mb-edit-frag-b')).toBeTruthy()

    const fragmentWarnings = errorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('React.Fragment'))
    )
    expect(fragmentWarnings).toEqual([])
    errorSpy.mockRestore()
  })
})
