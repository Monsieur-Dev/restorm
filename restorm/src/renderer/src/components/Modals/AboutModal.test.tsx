import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import appCatalog from '../../../locales/en/translation.json'

/** Props the stub captured from the last `Modal` render. */
let modalProps: { isOpen: boolean; onClose: () => void; title: ReactNode } | null = null

// ECUI resolves to its built dist in vitest, whose CSS side-imports don't
// resolve. Stub the two primitives this dialog composes, keeping the contract
// the component relies on: the body renders only while open, and the Button is
// a clickable element carrying its testid.
vi.mock('electron-core-ui/renderer', () => ({
  Modal: (props: {
    isOpen: boolean
    onClose: () => void
    title: ReactNode
    children: ReactNode
    'data-testid'?: string
  }): ReactNode => {
    modalProps = { isOpen: props.isOpen, onClose: props.onClose, title: props.title }
    if (!props.isOpen) return null
    return createElement(
      'div',
      { 'data-testid': props['data-testid'] },
      createElement('div', { 'data-testid': 'about-modal-title' }, props.title),
      props.children
    )
  },
  Button: (props: { onClick?: () => void; children?: ReactNode; 'data-testid'?: string }): ReactNode =>
    createElement(
      'button',
      { onClick: props.onClick, ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}) },
      props.children
    )
}))

/** The real English catalogue, so the test asserts the copy that ships. */
const CATALOG: Record<string, unknown> = appCatalog

function lookup(key: string): string {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    CATALOG
  )
  return typeof value === 'string' ? value : key
}

let language = 'en'

vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string, vars?: Record<string, unknown>) => string; i18n: { language: string } } => ({
    t: (key, vars) => {
      const raw = lookup(key)
      if (vars === undefined) return raw
      return Object.entries(vars).reduce(
        (out, [name, value]) => out.replace(`{{${name}}}`, String(value)),
        raw
      )
    },
    i18n: { language }
  })
}))

import { AboutModal } from './AboutModal'

function installApi(version: string): void {
  ;(window as unknown as { api: unknown }).api = {
    app: { getVersion: vi.fn(() => Promise.resolve(version)) }
  }
}

afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
  modalProps = null
  language = 'en'
  vi.restoreAllMocks()
})

describe('AboutModal', () => {
  it('renders nothing while closed', () => {
    installApi('0.1.20-preview')
    const { queryByTestId } = render(<AboutModal isOpen={false} onClose={vi.fn()} />)
    expect(queryByTestId('about-modal')).toBeNull()
  })

  it('shows the running version, preview suffix included', async () => {
    installApi('0.1.20-preview')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    await waitFor(() => {
      expect(getByTestId('about-modal-version').textContent).toBe('Version 0.1.20-preview')
    })
  })

  it('shows the release version without a suffix on a release build', async () => {
    installApi('1.0.0')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    await waitFor(() => {
      expect(getByTestId('about-modal-version').textContent).toBe('Version 1.0.0')
    })
  })

  it('renders the full-colour brand mark as an image, not a font glyph', () => {
    installApi('0.1.20-preview')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    const mark = getByTestId('about-modal-mark')
    expect(mark.tagName).toBe('IMG')
    expect(mark.getAttribute('src')).toBe('/imgs/logo.png')
  })

  it('presents the product as a registered trademark', () => {
    installApi('0.1.20-preview')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    expect(getByTestId('about-modal-name').textContent).toBe('Restorm®')
  })

  it('names the publisher and shows its logo', () => {
    installApi('0.1.20-preview')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    expect(getByTestId('about-modal-publisher').textContent).toBe('Monsieur Dev')
    expect(getByTestId('about-modal-publisher-logo').getAttribute('src'))
      .toBe('/imgs/monsieurdev-logo.svg')
  })

  it('carries the trademark and copyright lines', () => {
    installApi('0.1.20-preview')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    const text = getByTestId('about-modal').textContent
    expect(text).toContain('Restorm® is a trademark registered with the INPI.')
    expect(text).toContain('© 2026 Monsieur Dev. All rights reserved.')
  })

  it('closes on the Close button', () => {
    installApi('0.1.20-preview')
    const onClose = vi.fn()
    const { getByTestId } = render(<AboutModal isOpen onClose={onClose} />)
    fireEvent.click(getByTestId('about-modal-close-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hands the same close handler to the modal, so Esc and the backdrop dismiss it too', () => {
    installApi('0.1.20-preview')
    const onClose = vi.fn()
    render(<AboutModal isOpen onClose={onClose} />)
    expect(modalProps?.onClose).toBe(onClose)
    modalProps?.onClose()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens each site link externally instead of navigating the renderer', async () => {
    installApi('1.0.0')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    await waitFor(() => {
      expect(getByTestId('about-modal-version').textContent).toContain('1.0.0')
    })

    for (const [testid, url] of [
      ['about-modal-link-website', 'https://restorm.app/en'],
      ['about-modal-link-docs', 'https://restorm.app/en/docs'],
      ['about-modal-link-release-notes', 'https://restorm.app/en/changelog']
    ] as const) {
      const anchor = getByTestId(testid)
      expect(anchor.getAttribute('href')).toBe(url)
      const defaultPrevented = !fireEvent.click(anchor)
      expect(defaultPrevented).toBe(true)
      expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
    }
  })

  it('never lets an anchor navigate the renderer, even for a non-http href', async () => {
    installApi('1.0.0')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    await waitFor(() => {
      expect(getByTestId('about-modal-version').textContent).toContain('1.0.0')
    })

    // A relative href is what a future refactor would most plausibly
    // introduce. The scheme check must refuse to hand it to the browser AND
    // still cancel the navigation — a renderer that follows the link stops
    // being the app.
    const anchor = getByTestId('about-modal-link-docs')
    anchor.setAttribute('href', '/docs')
    const defaultPrevented = !fireEvent.click(anchor)
    expect(defaultPrevented).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it('points a preview build at the dev site', async () => {
    installApi('0.1.20-preview')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    await waitFor(() => {
      expect(getByTestId('about-modal-link-docs').getAttribute('href'))
        .toBe('https://dev.restorm-website.pages.dev/en/docs')
    })
  })

  it('follows the interface language into the site links', async () => {
    language = 'fr'
    installApi('1.0.0')
    const { getByTestId } = render(<AboutModal isOpen onClose={vi.fn()} />)
    await waitFor(() => {
      // French is the site's unprefixed default.
      expect(getByTestId('about-modal-link-docs').getAttribute('href'))
        .toBe('https://restorm.app/docs')
    })
  })
})
