import { describe, it, expect } from 'vitest'
import {
  ariaCheckedForToggleState,
  iconForToggleState,
  nextToggleStateOnClick,
  toToggleState
} from './toggleLogic'

describe('toToggleState', () => {
  it('maps booleans to the binary tri-state values', () => {
    expect(toToggleState(true)).toBe('checked')
    expect(toToggleState(false)).toBe('unchecked')
  })

  it('passes the indeterminate literal through unchanged', () => {
    expect(toToggleState('indeterminate')).toBe('indeterminate')
  })
})

describe('nextToggleStateOnClick', () => {
  it('toggles binary states', () => {
    expect(nextToggleStateOnClick('unchecked')).toBe('checked')
    expect(nextToggleStateOnClick('checked')).toBe('unchecked')
  })

  it('promotes indeterminate to checked (completing the partial state)', () => {
    // Explicit pin for the documented UX: a click on an
    // indeterminate Toggle moves the value to fully-checked, since
    // the user is acknowledging the partial state. Walking the other
    // way (indeterminate → unchecked) would bury the user's
    // intermediate progress.
    expect(nextToggleStateOnClick('indeterminate')).toBe('checked')
  })
})

describe('iconForToggleState', () => {
  it('returns null for unchecked (no icon rendered)', () => {
    expect(iconForToggleState('unchecked', undefined, 'dash')).toBeNull()
    expect(iconForToggleState('unchecked', 'star', 'dash')).toBeNull()
  })

  it('returns the indeterminate icon for indeterminate', () => {
    expect(iconForToggleState('indeterminate', undefined, 'dash')).toBe('dash')
    expect(iconForToggleState('indeterminate', 'star', 'remove')).toBe('remove')
  })

  it('returns the checked icon for checked, defaulting to "check"', () => {
    expect(iconForToggleState('checked', undefined, 'dash')).toBe('check')
    expect(iconForToggleState('checked', 'star', 'dash')).toBe('star')
  })
})

describe('ariaCheckedForToggleState', () => {
  it('maps indeterminate to "mixed" per the ARIA spec for tri-state checkboxes', () => {
    expect(ariaCheckedForToggleState('indeterminate')).toBe('mixed')
  })

  it('maps checked / unchecked to booleans', () => {
    expect(ariaCheckedForToggleState('checked')).toBe(true)
    expect(ariaCheckedForToggleState('unchecked')).toBe(false)
  })
})
