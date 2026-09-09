/**
 * Component tests for `<BookmarkRibbon>` + `<BookmarkRibbonStack>`
 * (electron-core-ui). Lives in restorm/tests/unit/ for the same
 * reason as EditableLabel.test.tsx: restorm already has React
 * Testing Library + jsdom wired up, and electron-core-ui
 * intentionally has no RTL stack.
 */

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookmarkRibbon } from '../../../electron-core-ui/src/renderer/components/BookmarkRibbon/BookmarkRibbon'
import {
  BookmarkRibbonStack,
  type Bookmark
} from '../../../electron-core-ui/src/renderer/components/BookmarkRibbon/BookmarkRibbonStack'
import { getColorFromString } from '../../../electron-core-ui/src/renderer/utils/colorFromString'
import '@testing-library/jest-dom/vitest'

// The components now read their user-facing strings (name placeholder, create /
// remove labels, the "Bookmark: {{label}}" aria-label, the Add button) through
// react-i18next. This test env has no i18n instance, so the real `t` returns the
// default string WITHOUT interpolating `{{label}}`. Mock a `t` that returns the
// default and interpolates its options, mirroring runtime — otherwise the
// aria-label asserts against a literal `{{label}}`.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, def?: unknown, opts?: Record<string, unknown>): string => {
      let s = typeof def === 'string' ? def : key
      const vars = (def !== null && typeof def === 'object' ? def : opts) as Record<string, unknown> | undefined
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
      return s
    },
    i18n: { language: 'en', changeLanguage: (): Promise<void> => Promise.resolve() }
  }),
  Trans: ({ children }: { children?: React.ReactNode }): React.ReactNode => children,
  initReactI18next: { type: '3rdParty', init: (): void => undefined }
}))

const noop = (): void => { /* intentionally empty */ }

describe('BookmarkRibbon', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('renders a button with the label and the "Bookmark: <label>" aria-label', () => {
      render(<BookmarkRibbon label="api" data-testid="rib" />)
      const btn = screen.getByTestId('rib')
      expect(btn.tagName).toBe('BUTTON')
      expect(btn).toHaveAttribute('aria-label', 'Bookmark: api')
      expect(btn).toHaveTextContent('api')
    })

    it('uses an explicit color when provided', () => {
      render(<BookmarkRibbon label="api" color="#ff8800" data-testid="rib" />)
      const btn = screen.getByTestId('rib')
      expect(btn.style.getPropertyValue('--bookmark-color')).toBe('#ff8800')
    })

    it('derives a deterministic color from the label when color is omitted', () => {
      render(<BookmarkRibbon label="users" data-testid="rib" />)
      const btn = screen.getByTestId('rib')
      expect(btn.style.getPropertyValue('--bookmark-color')).toBe(getColorFromString('users'))
    })
  })

  describe('editor tooltip', () => {
    it('opens the tooltip on click and pre-fills the rename input with the current label', async () => {
      const user = userEvent.setup()
      render(<BookmarkRibbon label="api" onRename={noop} data-testid="rib" />)
      await user.click(screen.getByTestId('rib'))
      const input = screen.getByTestId('rib-rename-input-input')
      if (!(input instanceof HTMLInputElement)) throw new Error('expected HTMLInputElement')
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('api')
    })

    it('commits a rename on Enter', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      render(<BookmarkRibbon label="api" onRename={onRename} data-testid="rib" />)
      await user.click(screen.getByTestId('rib'))
      const input = screen.getByTestId('rib-rename-input-input')
      await user.clear(input)
      await user.type(input, 'payments{Enter}')
      expect(onRename).toHaveBeenCalledExactlyOnceWith('payments')
    })

    it('skips onRename when the value is unchanged', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      render(<BookmarkRibbon label="api" onRename={onRename} data-testid="rib" />)
      await user.click(screen.getByTestId('rib'))
      await user.keyboard('{Enter}')
      expect(onRename).not.toHaveBeenCalled()
    })

    it('closes the tooltip on Escape without firing onRename', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      render(<BookmarkRibbon label="api" onRename={onRename} data-testid="rib" />)
      await user.click(screen.getByTestId('rib'))
      const input = screen.getByTestId('rib-rename-input-input')
      await user.clear(input)
      await user.type(input, 'payments{Escape}')
      expect(onRename).not.toHaveBeenCalled()
      expect(screen.queryByTestId('rib-rename-input-input')).not.toBeInTheDocument()
    })

    it('renders the remove button only when onRemove is provided', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <BookmarkRibbon label="api" onRename={noop} data-testid="rib" />
      )
      await user.click(screen.getByTestId('rib'))
      expect(screen.queryByTestId('rib-remove')).not.toBeInTheDocument()

      const onRemove = vi.fn()
      rerender(
        <BookmarkRibbon label="api" onRename={noop} onRemove={onRemove} data-testid="rib" />
      )
      expect(screen.getByTestId('rib-remove')).toBeInTheDocument()
    })

    it('fires onRemove and closes the tooltip when the remove button is clicked', async () => {
      const user = userEvent.setup()
      const onRemove = vi.fn()
      render(
        <BookmarkRibbon label="api" onRename={noop} onRemove={onRemove} data-testid="rib" />
      )
      await user.click(screen.getByTestId('rib'))
      await user.click(screen.getByTestId('rib-remove'))
      expect(onRemove).toHaveBeenCalledOnce()
      expect(screen.queryByTestId('rib-remove')).not.toBeInTheDocument()
    })

    it('renders the color picker only when onColorChange is provided', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <BookmarkRibbon label="api" onRename={noop} data-testid="rib" />
      )
      await user.click(screen.getByTestId('rib'))
      expect(screen.queryByTestId('rib-color-picker')).not.toBeInTheDocument()

      const onColorChange = vi.fn()
      rerender(
        <BookmarkRibbon label="api" onRename={noop} onColorChange={onColorChange} data-testid="rib" />
      )
      expect(screen.getByTestId('rib-color-picker')).toBeInTheDocument()
    })

    it('toggles aria-expanded on the ribbon button when the tooltip opens and closes', async () => {
      const user = userEvent.setup()
      render(<BookmarkRibbon label="api" onRename={noop} data-testid="rib" />)
      const btn = screen.getByTestId('rib')
      expect(btn).toHaveAttribute('aria-expanded', 'false')
      await user.click(btn)
      expect(btn).toHaveAttribute('aria-expanded', 'true')
      // Closing via the rename input's Escape handler.
      const input = screen.getByTestId('rib-rename-input-input')
      await user.click(input)
      await user.keyboard('{Escape}')
      expect(btn).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes when the user clicks outside the ribbon and the tooltip', async () => {
      const user = userEvent.setup()
      render(
        <>
          <BookmarkRibbon label="api" onRename={noop} data-testid="rib" />
          <button data-testid="outside">outside</button>
        </>
      )
      await user.click(screen.getByTestId('rib'))
      expect(screen.getByTestId('rib-rename-input-input')).toBeInTheDocument()
      await user.click(screen.getByTestId('outside'))
      expect(screen.queryByTestId('rib-rename-input-input')).not.toBeInTheDocument()
    })
  })

  describe('hover/focus animation gating', () => {
    /** jsdom doesn't run real CSS transitions, so the state-machine
     * advance hooks (`transitionend` on the LABEL's opacity for entry,
     * on the ROOT's height for exit) need to be fired by hand. These
     * helpers mirror the propertyName / target the production
     * `onTransitionEnd` filters on. */
    function fireEntryDone(root: HTMLElement): void {
      const label = root.querySelector('.ecui-bookmark-ribbon-label')
      if (!label) throw new Error('expected label child of ribbon')
      fireEvent.transitionEnd(label, { propertyName: 'opacity' })
    }
    function fireExitDone(root: HTMLElement): void {
      fireEvent.transitionEnd(root, { propertyName: 'height' })
    }

    it('hover for 1 s then leave: entry plays through to fully open before the exit starts', () => {
      render(<BookmarkRibbon label="api" data-testid="rib" />)
      const btn = screen.getByTestId('rib')

      expect(btn.className).not.toMatch(/--opening|--open|--closing/)

      act(() => { fireEvent.mouseEnter(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--opening')

      // Entry choreography completes (height + label fade-in done).
      act(() => { fireEntryDone(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--open')
      expect(btn.className).not.toContain('--opening')

      // User leaves AFTER the entry has settled — exit can start
      // immediately, no deferral.
      act(() => { fireEvent.mouseLeave(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--closing')
      expect(btn.className).not.toContain('--open')
    })

    it('hover for 0.1 s then leave: entry plays through, then the exit runs (no half-extended freeze)', () => {
      render(<BookmarkRibbon label="api" data-testid="rib" />)
      const btn = screen.getByTestId('rib')

      act(() => { fireEvent.mouseEnter(btn) })
      expect(btn.className).toContain('--opening')

      // User leaves WHILE entry still in flight — close is deferred,
      // ribbon stays in `--opening` until the entry's transitionend.
      // (`--open` would be a substring of `--opening`, so check the
      // exact phase classes via word boundary.)
      act(() => { fireEvent.mouseLeave(btn) })
      expect(btn.classList.contains('ecui-bookmark-ribbon--opening')).toBe(true)
      expect(btn.classList.contains('ecui-bookmark-ribbon--closing')).toBe(false)
      expect(btn.classList.contains('ecui-bookmark-ribbon--open')).toBe(false)

      // Entry finishes → reducer reads the deferred-leave flag and
      // jumps straight to closing. The user sees a full
      // open-then-close instead of a jagged half-entry.
      act(() => { fireEntryDone(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--closing')
      expect(btn.className).not.toContain('--opening')
    })

    it('re-enter while closing: cancels the exit and returns to opening cleanly (no double-trigger)', () => {
      render(<BookmarkRibbon label="api" data-testid="rib" />)
      const btn = screen.getByTestId('rib')

      // Open then settle, then start the exit.
      act(() => { fireEvent.mouseEnter(btn) })
      act(() => { fireEntryDone(btn) })
      act(() => { fireEvent.mouseLeave(btn) })
      expect(btn.className).toContain('--closing')

      // Cursor re-enters mid-exit — exit cancelled, ribbon goes back
      // to `--opening` to play a fresh entry from wherever the
      // collapse happened to be.
      act(() => { fireEvent.mouseEnter(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--opening')
      expect(btn.className).not.toContain('--closing')

      // A single entry transitionend completes the entry — proving
      // there's no stale prior entry queued.
      act(() => { fireEntryDone(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--open')
    })

    it('keyboard focus / blur path mirrors hover: entry locks until completion on focus, exit gating on blur', () => {
      render(<BookmarkRibbon label="api" data-testid="rib" />)
      const btn = screen.getByTestId('rib')

      // Focus instead of hover — the JS state machine treats them
      // symmetrically (any "wants-open" signal triggers ENTER).
      act(() => { fireEvent.focus(btn) })
      expect(btn.className).toContain('--opening')

      // Blur during opening — same defer behaviour as mouseLeave.
      act(() => { fireEvent.blur(btn) })
      expect(btn.className).toContain('--opening')
      expect(btn.className).not.toContain('--closing')

      act(() => { fireEntryDone(btn) })
      expect(btn.className).toContain('--closing')

      // Exit choreography completes → returns to idle.
      act(() => { fireExitDone(btn) })
      expect(btn.className).not.toMatch(/--opening|--open|--closing/)
    })

    it('self-heals out of opening when the entry transitionend never fires (stuck-open guard)', () => {
      vi.useFakeTimers()
      try {
        render(<BookmarkRibbon label="api" data-testid="rib" />)
        const btn = screen.getByTestId('rib')

        // Hover then leave WITHOUT ever firing the entry transitionend —
        // mirrors a dropped/coalesced CSS event. The reducer defers the
        // leave (stays `--opening`), and without a fallback it would wedge
        // here forever, leaving the ribbon visually extended.
        act(() => { fireEvent.mouseEnter(btn) })
        act(() => { fireEvent.mouseLeave(btn) })
        expect(btn.classList.contains('ecui-bookmark-ribbon--opening')).toBe(true)

        // The entry watchdog fires the missing ENTRY_DONE; the deferred
        // leave is honored and the ribbon proceeds to close.
        act(() => { vi.advanceTimersByTime(1500) })
        expect(btn.className).toContain('ecui-bookmark-ribbon--closing')
        expect(btn.classList.contains('ecui-bookmark-ribbon--opening')).toBe(false)

        // The exit watchdog then heals the missing exit transitionend,
        // returning the ribbon all the way to idle (collapsed).
        act(() => { vi.advanceTimersByTime(5000) })
        expect(btn.className).not.toMatch(/--opening|--open|--closing/)
      } finally {
        vi.useRealTimers()
      }
    })

    it('self-heals out of closing when the exit transitionend never fires (stuck-open guard)', () => {
      vi.useFakeTimers()
      try {
        render(<BookmarkRibbon label="api" data-testid="rib" />)
        const btn = screen.getByTestId('rib')

        // Open and settle, then leave to enter the exit phase.
        act(() => { fireEvent.mouseEnter(btn) })
        act(() => { fireEntryDone(btn) })
        act(() => { fireEvent.mouseLeave(btn) })
        expect(btn.className).toContain('ecui-bookmark-ribbon--closing')

        // The exit transitionend never arrives — without a fallback the
        // ribbon would stay extended. The watchdog collapses it.
        act(() => { vi.advanceTimersByTime(5000) })
        expect(btn.className).not.toMatch(/--opening|--open|--closing/)
      } finally {
        vi.useRealTimers()
      }
    })

    it('force-collapses a settled-open ribbon the moment no wants-open signal remains', () => {
      render(<BookmarkRibbon label="api" data-testid="rib" />)
      const btn = screen.getByTestId('rib')

      // Reach the settled `--open` phase.
      act(() => { fireEvent.mouseEnter(btn) })
      act(() => { fireEntryDone(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--open')

      // Pointer leaves — the hard guard guarantees the exit starts even
      // independent of the per-callsite LEAVE dispatch.
      act(() => { fireEvent.mouseLeave(btn) })
      expect(btn.className).toContain('ecui-bookmark-ribbon--closing')
    })

    it('locks the ribbon open while the editor tooltip is open, then resumes the exit on outside click', async () => {
      const user = userEvent.setup()
      render(
        <>
          <BookmarkRibbon label="api" onRename={noop} data-testid="rib" />
          <button data-testid="outside">outside</button>
        </>
      )
      const btn = screen.getByTestId('rib')

      // Click opens the editor tooltip and the editor-open flag pins
      // the state machine to a "wants-open" state. `userEvent.click`
      // fires the mouseenter / focus sequence synthetically.
      await user.click(btn)
      expect(btn.classList.contains('ecui-bookmark-ribbon--opening')).toBe(true)

      // Settle the entry choreography so the ribbon reaches `--open`.
      act(() => { fireEntryDone(btn) })
      expect(btn.classList.contains('ecui-bookmark-ribbon--open')).toBe(true)

      // Closing the tooltip via outside-click should let the cursor /
      // focus tracker take over — there is no longer any wants-open
      // signal (mouse moved off, focus moved away, editor closed), so
      // the exit choreography starts.
      await user.click(screen.getByTestId('outside'))
      expect(btn.classList.contains('ecui-bookmark-ribbon--closing')).toBe(true)
    })
  })

  describe('readonly mode', () => {
    it('does not open the editor tooltip when the ribbon is clicked with editable={false}', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      render(
        <BookmarkRibbon label="api" editable={false} onRename={onRename} data-testid="rib" />
      )
      await user.click(screen.getByTestId('rib'))
      expect(screen.queryByTestId('rib-rename-input-input')).not.toBeInTheDocument()
      expect(onRename).not.toHaveBeenCalled()
    })

    it('omits aria-expanded in readonly mode', () => {
      render(
        <BookmarkRibbon label="api" editable={false} data-testid="rib" />
      )
      expect(screen.getByTestId('rib')).not.toHaveAttribute('aria-expanded')
    })
  })
})

describe('BookmarkRibbonStack', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const bookmarks: Bookmark[] = [
    { label: 'api' },
    { label: 'beta', color: '#00aaff' }
  ]

  it('renders an [+] add ribbon followed by one ribbon per tag', () => {
    render(<BookmarkRibbonStack bookmarks={bookmarks} data-testid="stk" />)
    expect(screen.getByTestId('stk-add')).toBeInTheDocument()
    expect(screen.getByTestId('stk-ribbon-0')).toHaveTextContent('api')
    expect(screen.getByTestId('stk-ribbon-1')).toHaveTextContent('beta')
  })

  it('forwards rename / color / remove handlers with the tag index', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    const onColorChange = vi.fn()
    const onRemove = vi.fn()
    render(
      <BookmarkRibbonStack
        bookmarks={bookmarks}
        onRename={onRename}
        onColorChange={onColorChange}
        onRemove={onRemove}
        data-testid="stk"
      />
    )

    await user.click(screen.getByTestId('stk-ribbon-1'))
    const input = screen.getByTestId('stk-ribbon-1-rename-input-input')
    await user.clear(input)
    await user.type(input, 'gamma{Enter}')
    expect(onRename).toHaveBeenCalledExactlyOnceWith(1, 'gamma')

    await user.click(screen.getByTestId('stk-ribbon-1'))
    await user.click(screen.getByTestId('stk-ribbon-1-remove'))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(1)
  })

  describe('add flow', () => {
    it('opens the add tooltip on [+] click and creates a tag on Enter', async () => {
      const user = userEvent.setup()
      const onAdd = vi.fn()
      render(<BookmarkRibbonStack bookmarks={[]} onAdd={onAdd} data-testid="stk" />)
      await user.click(screen.getByTestId('stk-add'))
      const input = screen.getByTestId('stk-add-input-input')
      await user.click(input)
      await user.type(input, 'newtag{Enter}')
      expect(onAdd).toHaveBeenCalledExactlyOnceWith('newtag')
    })

    it('commits the typed name when the explicit Add button is clicked', async () => {
      const user = userEvent.setup()
      const onAdd = vi.fn()
      render(<BookmarkRibbonStack bookmarks={[]} onAdd={onAdd} data-testid="stk" />)
      await user.click(screen.getByTestId('stk-add'))
      const input = screen.getByTestId('stk-add-input-input')
      await user.click(input)
      await user.type(input, 'newtag')
      await user.click(screen.getByTestId('stk-add-confirm'))
      expect(onAdd).toHaveBeenCalledExactlyOnceWith('newtag')
    })

    it('closes the tooltip on Escape without calling onAdd', async () => {
      const user = userEvent.setup()
      const onAdd = vi.fn()
      render(<BookmarkRibbonStack bookmarks={[]} onAdd={onAdd} data-testid="stk" />)
      await user.click(screen.getByTestId('stk-add'))
      const input = screen.getByTestId('stk-add-input-input')
      await user.click(input)
      await user.type(input, 'newtag{Escape}')
      expect(onAdd).not.toHaveBeenCalled()
      expect(screen.queryByTestId('stk-add-input-input')).not.toBeInTheDocument()
    })

    it('trims the typed name and ignores a whitespace-only input', async () => {
      const user = userEvent.setup()
      const onAdd = vi.fn()
      render(<BookmarkRibbonStack bookmarks={[]} onAdd={onAdd} data-testid="stk" />)
      await user.click(screen.getByTestId('stk-add'))
      const input = screen.getByTestId('stk-add-input-input')
      await user.click(input)
      await user.type(input, '   {Enter}')
      expect(onAdd).not.toHaveBeenCalled()
    })

    it('closes the add tooltip when the user clicks outside of it', async () => {
      const user = userEvent.setup()
      render(
        <>
          <BookmarkRibbonStack bookmarks={[]} onAdd={noop} data-testid="stk" />
          <button data-testid="outside">outside</button>
        </>
      )
      await user.click(screen.getByTestId('stk-add'))
      expect(screen.getByTestId('stk-add-input-input')).toBeInTheDocument()
      await user.click(screen.getByTestId('outside'))
      expect(screen.queryByTestId('stk-add-input-input')).not.toBeInTheDocument()
    })
  })

  describe('readonly mode', () => {
    it('hides the [+] add ribbon when editable={false}', () => {
      render(
        <BookmarkRibbonStack bookmarks={bookmarks} editable={false} data-testid="stk" />
      )
      expect(screen.queryByTestId('stk-add')).not.toBeInTheDocument()
      expect(screen.queryByTestId('stk-add-tooltip')).not.toBeInTheDocument()
    })

    it('still renders a ribbon per tag in readonly mode, with no click handler', async () => {
      const user = userEvent.setup()
      const onRename = vi.fn()
      render(
        <BookmarkRibbonStack
          bookmarks={bookmarks}
          editable={false}
          onRename={onRename}
          data-testid="stk"
        />
      )
      expect(screen.getByTestId('stk-ribbon-0')).toHaveTextContent('api')
      expect(screen.getByTestId('stk-ribbon-1')).toHaveTextContent('beta')
      await user.click(screen.getByTestId('stk-ribbon-0'))
      expect(screen.queryByTestId('stk-ribbon-0-rename-input-input')).not.toBeInTheDocument()
      expect(onRename).not.toHaveBeenCalled()
    })
  })
})
