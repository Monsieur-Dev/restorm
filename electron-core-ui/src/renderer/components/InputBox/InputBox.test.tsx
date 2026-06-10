// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import InputBox from './InputBox'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const opts = { ariaLabel: 'field', placeholder: '' }

describe('InputBox debounce', () => {
  it('shows each keystroke instantly but debounces onChange (default 300ms)', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { getByLabelText } = render(<InputBox options={opts} value="" onChange={onChange} />)
    const input = getByLabelText('field') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.change(input, { target: { value: 'abc' } })

    // Draft is instant…
    expect(input.value).toBe('abc')
    // …but the parent hasn't been told yet (no per-keystroke persistence).
    expect(onChange).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(300) })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('abc')
  })

  it('flushes the pending change immediately on blur', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { getByLabelText } = render(<InputBox options={opts} value="" onChange={onChange} />)
    const input = getByLabelText('field')

    fireEvent.change(input, { target: { value: 'hi' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('hi')
  })

  it('emits on every keystroke when changeDebounceMs is 0 (opt-out)', () => {
    const onChange = vi.fn()
    const { getByLabelText } = render(
      <InputBox options={opts} value="" onChange={onChange} changeDebounceMs={0} />
    )
    const input = getByLabelText('field')

    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.change(input, { target: { value: 'xy' } })

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith('xy')
  })

  it('flushes a pending change on unmount (tab close before blur)', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { getByLabelText, unmount } = render(<InputBox options={opts} value="" onChange={onChange} />)
    const input = getByLabelText('field')

    fireEvent.change(input, { target: { value: 'draft' } })
    expect(onChange).not.toHaveBeenCalled()

    unmount()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('draft')
  })

  it('adopts an external value change without waiting for input', () => {
    const onChange = vi.fn()
    const { getByLabelText, rerender } = render(
      <InputBox options={opts} value="one" onChange={onChange} />
    )
    const input = getByLabelText('field') as HTMLInputElement
    expect(input.value).toBe('one')

    rerender(<InputBox options={opts} value="two" onChange={onChange} />)

    expect(input.value).toBe('two')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cancels a pending debounce when the value prop changes externally', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { getByLabelText, rerender } = render(
      <InputBox options={opts} value="" onChange={onChange} />
    )
    const input = getByLabelText('field') as HTMLInputElement

    // User types — a debounced emit of "draft" is now pending.
    fireEvent.change(input, { target: { value: 'draft' } })
    expect(onChange).not.toHaveBeenCalled()

    // The parent pushes a new value (programmatic reset) before the debounce fires.
    rerender(<InputBox options={opts} value="external" onChange={onChange} />)
    expect(input.value).toBe('external')

    // The stale timer must NOT fire and clobber the adopted value…
    act(() => { vi.advanceTimersByTime(300) })
    expect(onChange).not.toHaveBeenCalled()

    // …and a later blur must not re-emit the discarded draft either.
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })
})
