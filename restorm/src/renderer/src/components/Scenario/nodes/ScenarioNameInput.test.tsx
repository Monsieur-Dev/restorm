// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { ScenarioNameInput } from './ScenarioNameInput'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ScenarioNameInput', () => {
  it('reflects each keystroke locally but commits only once, after the debounce window', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    const { getByRole } = render(<ScenarioNameInput value="" placeholder="name" onCommit={onCommit} />)
    const input = getByRole('textbox') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'p' } })
    fireEvent.change(input, { target: { value: 'pl' } })
    fireEvent.change(input, { target: { value: 'player' } })

    // The field is responsive on every keystroke…
    expect(input.value).toBe('player')
    // …but nothing has been written to config yet — that's what kept the
    // whole scenario from re-rendering/persisting mid-word.
    expect(onCommit).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(300) })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('player')
  })

  it('flushes the pending value immediately on blur', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    const { getByRole } = render(<ScenarioNameInput value="" placeholder="name" onCommit={onCommit} />)
    const input = getByRole('textbox')

    fireEvent.change(input, { target: { value: 'count' } })
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.blur(input)

    // Blurring before the timer elapses must not lose the edit.
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('count')
  })

  it('adopts an external value change (reload / undo) without waiting for input', () => {
    const onCommit = vi.fn()
    const { getByRole, rerender } = render(
      <ScenarioNameInput value="old" placeholder="name" onCommit={onCommit} />
    )
    const input = getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('old')

    rerender(<ScenarioNameInput value="reloaded" placeholder="name" onCommit={onCommit} />)

    expect(input.value).toBe('reloaded')
    expect(onCommit).not.toHaveBeenCalled()
  })
})
