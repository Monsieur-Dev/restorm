// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { EnumRenderer } from './EnumRenderer'
import type { ResolvedSetting } from '../../../../types/settings'

// i18n is mocked to echo the fallback (2nd arg) so assertions read the
// same endonym the real bundle would resolve `labelKey` to, without
// depending on a loaded translation bundle.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback })
}))

// jsdom ships no ResizeObserver; opening the dropdown mounts a
// ScrollableElement which constructs one. A no-op stub lets it render.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  } as unknown as typeof ResizeObserver
})

afterEach(() => { cleanup() })

function makeSetting(overrides: Partial<ResolvedSetting> = {}): ResolvedSetting {
  return {
    id: 'language',
    titleKey: 'settings.appearance.language.title',
    type: 'enum',
    default: 'en',
    groupPath: ['appearance'],
    storageKey: 'appearance:language',
    currentValue: 'en',
    isModified: false,
    params: {
      values: [
        { value: 'en', labelKey: 'settings.appearance.language.en', flag: '🇬🇧' },
        { value: 'fr', labelKey: 'settings.appearance.language.fr', flag: '🇫🇷' }
      ]
    },
    ...overrides
  }
}

describe('EnumRenderer', () => {
  it('renders "{flag} {label}" when the EnumValue carries a flag', () => {
    render(<EnumRenderer setting={makeSetting()} value="en" onChange={vi.fn()} />)
    // EnumRenderer doesn't pass a `data-testid` to SelectBox, so it falls
    // back to SelectBox's own default root id ('selectbox').
    const trigger = screen.getByTestId('selectbox-trigger')
    expect(trigger.textContent).toContain('🇬🇧 en')
  })

  it('renders the label alone (no flag prefix) when the EnumValue has no flag', () => {
    const setting = makeSetting({
      id: 'autoSave',
      storageKey: 'files:autoSave',
      params: {
        values: [
          { value: 'off', labelKey: 'settings.files.autoSave.off' },
          { value: 'onFocusChange', labelKey: 'settings.files.autoSave.onFocusChange' }
        ]
      }
    })
    render(<EnumRenderer setting={setting} value="off" onChange={vi.fn()} />)
    const trigger = screen.getByTestId('selectbox-trigger')
    expect(trigger.textContent).toBe('off')
  })

  it('selecting an option by index reports its value via onChange', () => {
    const onChange = vi.fn()
    render(<EnumRenderer setting={makeSetting()} value="en" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('selectbox-trigger'))
    fireEvent.click(screen.getByTestId('selectbox-option-1'))
    expect(onChange).toHaveBeenCalledWith('fr')
  })
})
