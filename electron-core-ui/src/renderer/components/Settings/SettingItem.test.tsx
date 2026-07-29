// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { SettingItem } from './SettingItem'
import type { ResolvedSetting } from '../../../types/settings'
import type { CapabilityGate } from '../../contexts/settingsContextDef'

const { useSettingsMock } = vi.hoisted(() => ({
  useSettingsMock: vi.fn<() => { capabilityGate?: CapabilityGate }>()
}))
vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => useSettingsMock()
}))

function makeSetting(overrides: Partial<ResolvedSetting> = {}): ResolvedSetting {
  return {
    id: 'semiPullFrequency',
    titleKey: 'git.semiPullFrequencyTitle',
    type: 'toggle',
    default: false,
    groupPath: ['git'],
    storageKey: 'git:semiPullFrequency',
    currentValue: false,
    isModified: false,
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingItem — capabilityLockedValue', () => {
  /** The toggle's own checked state, as `ToggleRenderer` renders it. */
  function renderedToggleState(): string | null {
    return document.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') ?? null
  }

  it('displays the forced value, not the stored one, while the setting is locked', () => {
    // The failure this prevents: a plan that mandates a setting the user had
    // previously turned off would render a greyed OFF toggle while the app
    // behaved as ON — telling the user the opposite of what is happening.
    useSettingsMock.mockReturnValue({ capabilityGate: { isLocked: () => true, onSubscribe: vi.fn() } })
    render(
      <SettingItem
        setting={makeSetting({ capability: 'crash.optOut', capabilityLockedValue: true })}
        value={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(renderedToggleState()).toBe('true')
  })

  it('shows the stored value again as soon as the lock lifts — the choice was never overwritten', () => {
    useSettingsMock.mockReturnValue({ capabilityGate: { isLocked: () => false, onSubscribe: vi.fn() } })
    render(
      <SettingItem
        setting={makeSetting({ capability: 'crash.optOut', capabilityLockedValue: true })}
        value={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(renderedToggleState()).toBe('false')
  })

  it('leaves the stored value showing when a locked setting declares no forced value', () => {
    useSettingsMock.mockReturnValue({ capabilityGate: { isLocked: () => true, onSubscribe: vi.fn() } })
    render(
      <SettingItem
        setting={makeSetting({ capability: 'git.client' })}
        value={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(renderedToggleState()).toBe('false')
  })
})

describe('SettingItem — capability gating', () => {
  it('a setting with no `capability` tag is never gated, regardless of capabilityGate', () => {
    useSettingsMock.mockReturnValue({ capabilityGate: { isLocked: () => true, onSubscribe: vi.fn() } })
    render(<SettingItem setting={makeSetting()} value={false} onChange={vi.fn()} onReset={vi.fn()} />)
    // GatedControl passthrough leaves no gating wrapper in the DOM at all.
    expect(document.querySelector('.ecu-gated')).toBeNull()
  })

  it('a `capability`-tagged setting renders LOCKED when capabilityGate.isLocked returns true', () => {
    useSettingsMock.mockReturnValue({ capabilityGate: { isLocked: () => true, onSubscribe: vi.fn() } })
    render(
      <SettingItem
        setting={makeSetting({ capability: 'git.client' })}
        value={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(document.querySelector('.ecu-gated')).not.toBeNull()
    expect(document.querySelector('.ecu-gated-child')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('a `capability`-tagged setting renders UNLOCKED when capabilityGate.isLocked returns false', () => {
    useSettingsMock.mockReturnValue({ capabilityGate: { isLocked: () => false, onSubscribe: vi.fn() } })
    render(
      <SettingItem
        setting={makeSetting({ capability: 'git.client' })}
        value={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(document.querySelector('.ecu-gated')).toBeNull()
  })

  it('a `capability`-tagged setting fails OPEN (unlocked) when the host never wired a capabilityGate at all', () => {
    useSettingsMock.mockReturnValue({})
    render(
      <SettingItem
        setting={makeSetting({ capability: 'git.client' })}
        value={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(document.querySelector('.ecu-gated')).toBeNull()
  })

  it('clicking the locked tooltip\'s Subscribe link calls capabilityGate.onSubscribe', () => {
    const onSubscribe = vi.fn()
    useSettingsMock.mockReturnValue({ capabilityGate: { isLocked: () => true, onSubscribe } })
    render(
      <SettingItem
        setting={makeSetting({ capability: 'git.client', storageKey: 'git:semiPullFrequency' })}
        value={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    const gate = screen.getByTestId('setting-gate-git:semiPullFrequency')
    fireEvent.mouseEnter(gate)
    fireEvent.click(screen.getByTestId('setting-gate-git:semiPullFrequency-subscribe'))
    expect(onSubscribe).toHaveBeenCalledTimes(1)
  })
})
