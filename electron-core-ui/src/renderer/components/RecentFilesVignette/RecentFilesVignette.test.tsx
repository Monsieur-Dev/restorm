// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { RecentFilesVignette } from './RecentFilesVignette'
import type { FileMetadata } from '../../../types/file'

// i18n is mocked to echo the key so assertions don't depend on a loaded bundle.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// The row's chrome (frosted frame, scroller, Lottie star) is irrelevant to the
// text layout under test and costly to mount in jsdom, so each is reduced to a
// plain passthrough.
vi.mock('../Vignette', () => ({
  Vignette: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('../ScrollableElement', () => ({
  ScrollableElement: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('../Toggle', () => ({
  Toggle: (props: { 'data-testid'?: string }) => <span data-testid={props['data-testid']} />
}))
// Tooltip and ContextMenu are stubbed to make their inputs observable: what
// matters here is WHETHER they are shown and with what content / items, not
// how they position themselves (jsdom has no layout to position against).
vi.mock('../Tooltip', () => ({
  Tooltip: ({ content, show, 'data-testid': testId }: {
    content?: React.ReactNode
    show?: boolean
    'data-testid'?: string
  }) => (show === true ? <div data-testid={testId}>{content}</div> : null)
}))
vi.mock('../ContextMenu/ContextMenu', () => ({
  ContextMenu: ({ items, x, y, 'data-testid': testId }: {
    items: { id: string; label: string; onClick?: () => void; 'data-testid'?: string }[]
    x: number
    y: number
    'data-testid'?: string
  }) => (
    <div data-testid={testId} data-x={String(x)} data-y={String(y)}>
      {items.map((item) => (
        <button key={item.id} data-testid={item['data-testid']} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  )
}))

/**
 * jsdom reports every width as 0, so an element is never "overflowing" by
 * default. Force the head span's measurements for the duration of one test.
 */
function withHeadTruncation(truncated: boolean, run: () => void): void {
  const proto = window.HTMLElement.prototype
  const scroll = Object.getOwnPropertyDescriptor(proto, 'scrollWidth')
  const client = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => (truncated ? 500 : 100) })
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 100 })
  try {
    run()
  } finally {
    if (scroll) Object.defineProperty(proto, 'scrollWidth', scroll)
    else delete (proto as unknown as Record<string, unknown>)['scrollWidth']
    if (client) Object.defineProperty(proto, 'clientWidth', client)
    else delete (proto as unknown as Record<string, unknown>)['clientWidth']
  }
}

const FAVORITE: FileMetadata = {
  path: '/home/user/Documents/Projects/enterprise/backend/api-collections/payments.app',
  name: 'payments',
  lastOpened: 2,
  isFavorite: true
}
const RECENT: FileMetadata = {
  path: '/home/user/workspace/checkout/regression.app',
  name: 'regression',
  lastOpened: 1,
  isFavorite: false
}

const fileService = {
  recentFiles: [RECENT] as FileMetadata[],
  favorites: [FAVORITE] as FileMetadata[],
  toggleFavorite: vi.fn(() => Promise.resolve(true))
}
vi.mock('../../hooks/useFileService', () => ({
  useFileService: () => fileService
}))

afterEach(() => { cleanup() })

/** The name / path / head / tail spans of every rendered row, in DOM order. */
function rows(): {
  name: string
  path: string
  head: string
  tail: string
  nameBeforePath: boolean
}[] {
  return Array.from(document.querySelectorAll('.ecu-recent-files-vignette-item')).map((row) => {
    const name = row.querySelector('.ecu-recent-files-vignette-item-name')
    const path = row.querySelector('.ecu-recent-files-vignette-item-path')
    const head = row.querySelector('.ecu-recent-files-vignette-item-path-head')
    const tail = row.querySelector('.ecu-recent-files-vignette-item-path-tail')
    return {
      name: name?.textContent ?? '',
      path: path?.textContent ?? '',
      head: head?.textContent ?? '',
      tail: tail?.textContent ?? '',
      // `compareDocumentPosition` returns FOLLOWING when path comes after name,
      // which is what "path is the second line" means structurally.
      nameBeforePath:
        name != null &&
        path != null &&
        (name.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    }
  })
}

describe('RecentFilesVignette rows', () => {
  it('stacks the name over the directory in both the favorites and the recents list', () => {
    render(<RecentFilesVignette onOpenFile={vi.fn()} />)

    const rendered = rows()
    expect(rendered).toHaveLength(2)
    for (const row of rendered) {
      expect(row.nameBeforePath).toBe(true)
    }
    expect(rendered[0]?.name).toBe('payments.app')
    expect(rendered[0]?.path).toBe('/home/user/Documents/Projects/enterprise/backend/api-collections')
    expect(rendered[1]?.name).toBe('regression.app')
    expect(rendered[1]?.path).toBe('/home/user/workspace/checkout')
  })

  it('wraps both lines in a single text column so the name ellipses on its own line', () => {
    render(<RecentFilesVignette onOpenFile={vi.fn()} />)

    for (const row of Array.from(document.querySelectorAll('.ecu-recent-files-vignette-item'))) {
      const column = row.querySelector('.ecu-recent-files-vignette-item-text')
      expect(column).not.toBeNull()
      expect(column?.querySelector('.ecu-recent-files-vignette-item-name')).not.toBeNull()
      expect(column?.querySelector('.ecu-recent-files-vignette-item-path')).not.toBeNull()
    }
  })

  it('splits the directory so the immediate parent folder is the unshrinkable tail', () => {
    render(<RecentFilesVignette onOpenFile={vi.fn()} />)

    const rendered = rows()
    expect(rendered[0]?.head).toBe('/home/user/Documents/Projects/enterprise/backend/')
    expect(rendered[0]?.tail).toBe('api-collections')
    expect(rendered[1]?.head).toBe('/home/user/workspace/')
    expect(rendered[1]?.tail).toBe('checkout')
    // Splitting must be lossless — selectors that match a row by its text
    // (and the accessible name) depend on the concatenation being unchanged.
    for (const row of rendered) {
      expect(row.head + row.tail).toBe(row.path)
    }
  })

  it('keeps the star to the right of the text column in both lists', () => {
    render(<RecentFilesVignette onOpenFile={vi.fn()} />)

    expect(screen.getByTestId('recent-files-vignette-remove-favorite-button')).not.toBeNull()
    expect(screen.getByTestId('recent-files-vignette-toggle-favorite-button')).not.toBeNull()
    for (const row of Array.from(document.querySelectorAll('.ecu-recent-files-vignette-item'))) {
      const text = row.querySelector('.ecu-recent-files-vignette-item-text')
      const star = row.querySelector('.ecu-recent-files-vignette-toggle-wrap')
      expect(text).not.toBeNull()
      expect(star).not.toBeNull()
      expect(
        text != null && star != null &&
        (text.compareDocumentPosition(star) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      ).toBe(true)
    }
  })

  it('omits the path line for a bare filename with no directory', () => {
    fileService.favorites = []
    fileService.recentFiles = [{ path: 'orphan.app', name: 'orphan', lastOpened: 1, isFavorite: false }]
    try {
      render(<RecentFilesVignette onOpenFile={vi.fn()} />)
      const rendered = rows()
      expect(rendered).toHaveLength(1)
      expect(rendered[0]?.name).toBe('orphan.app')
      expect(document.querySelector('.ecu-recent-files-vignette-item-path')).toBeNull()
    } finally {
      fileService.favorites = [FAVORITE]
      fileService.recentFiles = [RECENT]
    }
  })
})

const TOOLTIP = 'recent-files-vignette-path-tooltip'
const MENU = 'recent-files-vignette-context-menu'
const REVEAL = 'recent-files-vignette-reveal-in-folder'

/** The path line of the first rendered row. */
function firstPathLine(): Element {
  const line = document.querySelector('.ecu-recent-files-vignette-item-path')
  if (!line) throw new Error('no path line rendered')
  return line
}

/** The clickable inner of the row at `index` (0 = the favorites entry). */
function rowInner(index: number): Element {
  const inner = document.querySelectorAll('.ecu-recent-files-vignette-item-inner')[index]
  if (!inner) throw new Error(`no row rendered at index ${String(index)}`)
  return inner
}

describe('RecentFilesVignette full-path tooltip', () => {
  it('shows the whole absolute path when the directory is truncated', () => {
    withHeadTruncation(true, () => {
      render(<RecentFilesVignette onOpenFile={vi.fn()} />)
      expect(screen.queryByTestId(TOOLTIP)).toBeNull()
      fireEvent.mouseEnter(firstPathLine())
      // Exactly one — the hovered row's, not every row's.
      const tooltips = screen.getAllByTestId(TOOLTIP)
      expect(tooltips).toHaveLength(1)
      expect(tooltips[0]?.textContent).toBe(FAVORITE.path)
    })
  })

  it('stays silent when the directory fits — nothing is hidden to reveal', () => {
    withHeadTruncation(false, () => {
      render(<RecentFilesVignette onOpenFile={vi.fn()} />)
      fireEvent.mouseEnter(firstPathLine())
      expect(screen.queryByTestId(TOOLTIP)).toBeNull()
    })
  })

  it('hides again when the pointer leaves', () => {
    withHeadTruncation(true, () => {
      render(<RecentFilesVignette onOpenFile={vi.fn()} />)
      const line = firstPathLine()
      fireEvent.mouseEnter(line)
      expect(screen.getAllByTestId(TOOLTIP).length).toBeGreaterThan(0)
      fireEvent.mouseLeave(line)
      expect(screen.queryByTestId(TOOLTIP)).toBeNull()
    })
  })
})

describe('RecentFilesVignette open-containing-folder menu', () => {
  it('offers nothing on right-click when the consumer supplies no handler', () => {
    render(<RecentFilesVignette onOpenFile={vi.fn()} />)
    fireEvent.contextMenu(rowInner(0))
    expect(screen.queryByTestId(MENU)).toBeNull()
  })

  it('opens at the pointer and reveals the right-clicked file', () => {
    const onRevealInFolder = vi.fn()
    render(<RecentFilesVignette onOpenFile={vi.fn()} onRevealInFolder={onRevealInFolder} />)

    const favoriteRow = rowInner(0)
    fireEvent.contextMenu(favoriteRow, { clientX: 120, clientY: 240 })

    const menu = screen.getByTestId(MENU)
    expect(menu.getAttribute('data-x')).toBe('120')
    expect(menu.getAttribute('data-y')).toBe('240')
    fireEvent.click(screen.getByTestId(REVEAL))
    expect(onRevealInFolder).toHaveBeenCalledWith(FAVORITE.path)
  })

  it('reveals the recents row when that is the one right-clicked', () => {
    const onRevealInFolder = vi.fn()
    render(<RecentFilesVignette onOpenFile={vi.fn()} onRevealInFolder={onRevealInFolder} />)

    const recentRow = rowInner(1)
    fireEvent.contextMenu(recentRow)
    fireEvent.click(screen.getByTestId(REVEAL))
    expect(onRevealInFolder).toHaveBeenCalledWith(RECENT.path)
  })

  it('does not open the file when the row is right-clicked', () => {
    const onOpenFile = vi.fn()
    render(<RecentFilesVignette onOpenFile={onOpenFile} onRevealInFolder={vi.fn()} />)
    fireEvent.contextMenu(rowInner(0))
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})
