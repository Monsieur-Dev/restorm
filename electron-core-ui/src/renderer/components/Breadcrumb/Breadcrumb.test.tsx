// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { Breadcrumb } from './Breadcrumb'

afterEach(() => { cleanup() })

const ITEMS = [
  { id: 'root', label: 'Petstore' },
  { id: 'mid', label: 'Pets' },
  { id: 'leaf', label: 'Find pet by ID' }
]

describe('Breadcrumb', () => {
  it('default mode renders ancestor items as link buttons', () => {
    render(<Breadcrumb items={ITEMS} data-testid="bc" />)
    const nav = screen.getByTestId('bc')
    // Two ancestors → two link buttons; the last item is the current page.
    expect(nav.querySelectorAll('.ecui-breadcrumb-link:not(.ecui-breadcrumb-link--current)').length).toBe(2)
  })

  it('plain mode renders every item as a static label — no buttons, separators kept', () => {
    render(<Breadcrumb plain items={ITEMS} data-testid="bc" />)
    const nav = screen.getByTestId('bc')
    expect(nav.querySelectorAll('a, button, .ecui-breadcrumb-link').length).toBe(0)
    const labels = [...nav.querySelectorAll('.ecui-breadcrumb-plain-item')].map((n) => n.textContent)
    expect(labels).toEqual(['Petstore', 'Pets', 'Find pet by ID'])
    // Separators between items only — none trailing.
    expect(nav.querySelectorAll('.ecui-breadcrumb-separator').length).toBe(2)
  })

  it('plain mode renders an item prefix node and marks the last item as current', () => {
    render(
      <Breadcrumb
        plain
        items={[
          { id: 'root', label: 'Petstore' },
          { id: 'leaf', label: 'Find pet by ID', prefix: <span data-testid="the-badge">GET</span> }
        ]}
        data-testid="bc"
      />
    )
    const nav = screen.getByTestId('bc')
    const current = nav.querySelector('.ecui-breadcrumb-plain-item--current')
    expect(current?.textContent).toBe('GETFind pet by ID')
    expect(current?.querySelector('[data-testid=the-badge]')).toBeTruthy()
  })
})
