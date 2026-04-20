/**
 * Component tests for `<BookmarkRibbon>` + `<BookmarkRibbonStack>`
 * (electron-core-ui). Lives in restorm/tests/unit/ for the same
 * reason as EditableLabel.test.tsx: restorm already has React
 * Testing Library + jsdom wired up, and electron-core-ui
 * intentionally has no RTL stack.
 */

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookmarkRibbon } from '../../../electron-core-ui/src/renderer/components/BookmarkRibbon/BookmarkRibbon'
import {
  BookmarkRibbonStack,
  type BookmarkRibbonTag
} from '../../../electron-core-ui/src/renderer/components/BookmarkRibbon/BookmarkRibbonStack'
import { getColorFromString } from '../../../electron-core-ui/src/renderer/utils/colorFromString'
import '@testing-library/jest-dom/vitest'

const noop = (): void => { /* intentionally empty */ }

describe('BookmarkRibbon', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('rendering', () => {
    it('renders a button with the label and the "Tag: <label>" aria-label', () => {
      render(<BookmarkRibbon label="api" data-testid="rib" />)
      const btn = screen.getByTestId('rib')
      expect(btn.tagName).toBe('BUTTON')
      expect(btn).toHaveAttribute('aria-label', 'Tag: api')
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
      // Closing via the rename input's Escape handler — that's the path
      // keyboard users take; clicking outside would need a document-level
      // click handler (not exercised by the component).
      const input = screen.getByTestId('rib-rename-input-input')
      await user.click(input)
      await user.keyboard('{Escape}')
      expect(btn).toHaveAttribute('aria-expanded', 'false')
    })
  })
})

describe('BookmarkRibbonStack', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const tags: BookmarkRibbonTag[] = [
    { label: 'api' },
    { label: 'beta', color: '#00aaff' }
  ]

  it('renders an [+] add ribbon followed by one ribbon per tag', () => {
    render(<BookmarkRibbonStack tags={tags} data-testid="stk" />)
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
        tags={tags}
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
      render(<BookmarkRibbonStack tags={[]} onAdd={onAdd} data-testid="stk" />)
      await user.click(screen.getByTestId('stk-add'))
      const input = screen.getByTestId('stk-add-input-input')
      await user.click(input)
      await user.type(input, 'newtag{Enter}')
      expect(onAdd).toHaveBeenCalledExactlyOnceWith('newtag')
    })

    it('commits the typed name when the explicit Add button is clicked', async () => {
      const user = userEvent.setup()
      const onAdd = vi.fn()
      render(<BookmarkRibbonStack tags={[]} onAdd={onAdd} data-testid="stk" />)
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
      render(<BookmarkRibbonStack tags={[]} onAdd={onAdd} data-testid="stk" />)
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
      render(<BookmarkRibbonStack tags={[]} onAdd={onAdd} data-testid="stk" />)
      await user.click(screen.getByTestId('stk-add'))
      const input = screen.getByTestId('stk-add-input-input')
      await user.click(input)
      await user.type(input, '   {Enter}')
      expect(onAdd).not.toHaveBeenCalled()
    })
  })
})
