// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { GitHistoryView } from './GitHistoryView'
import type { GitHistoryCommit } from './types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}))

beforeAll(() => {
  // jsdom has no ResizeObserver; ScrollableElement + Sash both observe.
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    }
  }
})

afterEach(() => { cleanup() })

const COMMITS: GitHistoryCommit[] = [
  { hash: 'bbbbbbbbbb', parents: ['aaaaaaaaaa'], subject: 'Second', body: 'Body text', authorName: 'Yoann', authorEmail: 'y@d.fr', date: '2026-07-19T06:00:00+02:00', refs: ['HEAD -> main', 'origin/main'] },
  { hash: 'aaaaaaaaaa', parents: [], subject: 'First', body: '', authorName: 'Yoann', authorEmail: 'y@d.fr', date: '2026-07-19T05:00:00+02:00', refs: [] }
]

describe('GitHistoryView', () => {
  it('lists commits newest-first with refs badges and selects the first by default', () => {
    render(<GitHistoryView commits={COMMITS} mainTipHash="bbbbbbbbbb" />)
    const rows = screen.getAllByRole('option')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Second')
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true')
    expect(rows[0]?.textContent).toContain('origin/main')
    // Details pane shows the selected commit's full hash + author.
    const details = screen.getByTestId('git-history-view-details')
    expect(details.textContent).toContain('bbbbbbbbbb')
    expect(details.textContent).toContain('Yoann')
    expect(details.textContent).toContain('Body text')
  })

  it('clicking a row moves the selection and the details follow', () => {
    render(<GitHistoryView commits={COMMITS} mainTipHash="bbbbbbbbbb" />)
    fireEvent.click(screen.getByTestId('git-history-view-row-aaaaaaaa'))
    const details = screen.getByTestId('git-history-view-details')
    expect(details.textContent).toContain('First')
    expect(details.textContent).toContain('aaaaaaaaaa')
  })

  it('renders one SVG lane gutter per row', () => {
    const { container } = render(<GitHistoryView commits={COMMITS} mainTipHash="bbbbbbbbbb" />)
    expect(container.querySelectorAll('.ecui-git-history-lanes')).toHaveLength(2)
  })
})
