// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { GatedControl } from './GatedControl'

afterEach(() => { cleanup() })

describe('GatedControl', () => {
  it('unlocked: renders the child untouched, no gating wrapper', () => {
    const { container } = render(
      <GatedControl locked={false}>
        <button type="button">Step</button>
      </GatedControl>
    )
    expect(container.querySelector('.ecu-gated')).toBeNull()
    expect(container.querySelector('button')?.textContent).toBe('Step')
  })

  it('locked: wraps the child greyed + pointer-inert, kept in the a11y tree', () => {
    const { container } = render(
      <GatedControl locked data-testid="gate">
        <button type="button">Step</button>
      </GatedControl>
    )
    const anchor = container.querySelector('.ecu-gated')
    expect(anchor).not.toBeNull()
    const child = container.querySelector('.ecu-gated-child')
    expect(child?.getAttribute('aria-disabled')).toBe('true')
    // The control stays visible (NOT removed), only greyed.
    expect(child?.querySelector('button')?.textContent).toBe('Step')
  })

  it('locked: hovering reveals the « Version Pro » upsell + a « S\'abonner » link', () => {
    const onSubscribe = vi.fn()
    render(
      <GatedControl locked onSubscribe={onSubscribe} data-testid="gate"
        proLabel="Version Pro" subscribeLabel="S'abonner">
        <button type="button">Step</button>
      </GatedControl>
    )
    // Hidden until hover.
    expect(screen.queryByTestId('gate-subscribe')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('gate'))
    expect(screen.getByText('Version Pro')).not.toBeNull()
    const link = screen.getByTestId('gate-subscribe')
    fireEvent.click(link)
    expect(onSubscribe).toHaveBeenCalledTimes(1)
  })
})
