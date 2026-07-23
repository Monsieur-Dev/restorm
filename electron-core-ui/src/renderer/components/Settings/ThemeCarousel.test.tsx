// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ThemeCarousel } from './ThemeCarousel'
import type { ThemeInfo } from '../../../types/theme'
import type { ThemeContextValue } from '../../contexts/ThemeContext'

const { useThemeContextMock } = vi.hoisted(() => ({
  useThemeContextMock: vi.fn<() => Partial<ThemeContextValue>>()
}))
vi.mock('../../contexts/useThemeContext', () => ({
  useThemeContext: () => useThemeContextMock()
}))

const THEMES: ThemeInfo[] = [
  { id: 'dark-plus', name: 'Dark+', type: 'dark', path: '/dark-plus.json' },
  { id: 'monokai', name: 'Monokai', type: 'dark', path: '/monokai.json' },
  { id: 'default-light', name: 'Default Light', type: 'light', path: '/default-light.json' }
]

beforeAll(() => {
  // jsdom has no ResizeObserver; ScrollableElement observes its container.
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    }
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ThemeCarousel — the preview is a non-interactive abstract "mini-screenshot"', () => {
  it('every card exposes exactly one focusable element (the card button) — the preview holds none', () => {
    useThemeContextMock.mockReturnValue({
      themes: THEMES,
      currentThemeId: 'dark-plus',
      setTheme: vi.fn(),
      isLoading: false
    })
    const { container } = render(<ThemeCarousel />)

    const cards = container.querySelectorAll('.theme-carousel-item')
    expect(cards.length).toBe(THEMES.length)

    cards.forEach((card) => {
      // The card is a real <button>, focusable by default (AC #3).
      expect(card.tagName).toBe('BUTTON')
      expect(card.getAttribute('tabindex')).not.toBe('-1')
      expect(card.hasAttribute('disabled')).toBe(false)

      // Unlike the earlier `inert`-based approach, this is a genuine
      // redesign — the preview is built entirely from plain <div>/<span>
      // elements, no ECUI control, no native interactive tag, no explicit
      // tabIndex. That makes the "zero tab stops inside the preview"
      // guarantee (AC #2) trivially, structurally true, and — unlike
      // `inert` — jsdom can prove it directly with a plain DOM query
      // (no browser-only focus semantics involved this time).
      const preview = card.querySelector('.theme-carousel-item-preview')
      expect(preview).not.toBeNull()
      expect(
        preview?.querySelectorAll('button, a, input, select, textarea, [role="combobox"], [role="button"], [tabindex]').length
      ).toBe(0)
    })
  })

  it('renders the theme name as the preview title, and each card shows its own name (no cross-card leakage)', () => {
    useThemeContextMock.mockReturnValue({
      themes: THEMES,
      currentThemeId: 'monokai',
      setTheme: vi.fn(),
      isLoading: false
    })
    const { container } = render(<ThemeCarousel />)
    const cards = Array.from(container.querySelectorAll('.theme-carousel-item'))
    expect(cards.length).toBe(THEMES.length)

    cards.forEach((card, index) => {
      const title = card.querySelector('.theme-carousel-item-preview-title')
      expect(title?.textContent).toBe(THEMES[index]?.name)
    })
  })

  it('renders the full preview structure — sidebar, two paragraphs, accent, primary/secondary action pills', () => {
    useThemeContextMock.mockReturnValue({
      themes: THEMES,
      currentThemeId: 'dark-plus',
      setTheme: vi.fn(),
      isLoading: false
    })
    const { container } = render(<ThemeCarousel />)
    const preview = container.querySelector('.theme-carousel-item-preview')

    expect(preview?.querySelectorAll('.theme-carousel-item-preview-sidebar-item').length).toBe(3)
    expect(preview?.querySelectorAll('.theme-carousel-item-preview-paragraph').length).toBe(2)
    expect(preview?.querySelector('.theme-carousel-item-preview-accent')).not.toBeNull()
    expect(preview?.querySelector('.theme-carousel-item-preview-button--primary')).not.toBeNull()
    expect(preview?.querySelector('.theme-carousel-item-preview-button--secondary')).not.toBeNull()
  })

  it('the selected card carries aria-pressed="true", every other card aria-pressed="false"', () => {
    useThemeContextMock.mockReturnValue({
      themes: THEMES,
      currentThemeId: 'monokai',
      setTheme: vi.fn(),
      isLoading: false
    })
    const { container } = render(<ThemeCarousel />)
    const cards = Array.from(container.querySelectorAll('.theme-carousel-item'))

    cards.forEach((card, index) => {
      const expectedPressed = THEMES[index]?.id === 'monokai'
      expect(card.getAttribute('aria-pressed')).toBe(String(expectedPressed))
    })
  })
})
