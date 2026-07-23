import { describe, it, expect } from 'vitest'
import { buildSettingsStorageKey, isSettingItem, isGroupItem } from './settings'

describe('buildSettingsStorageKey', () => {
  it('joins a single-level group and the setting id with a colon', () => {
    expect(buildSettingsStorageKey(['git'], 'semiPullFrequency')).toBe('git:semiPullFrequency')
  })

  it('dot-joins a multi-level group path, then a colon before the setting id', () => {
    expect(buildSettingsStorageKey(['appearance', 'editor'], 'fontSize')).toBe('appearance.editor:fontSize')
  })

  it('falls back to the bare setting id when the group path is empty', () => {
    expect(buildSettingsStorageKey([], 'topLevelSetting')).toBe('topLevelSetting')
  })
})

describe('isSettingItem / isGroupItem', () => {
  it('narrows a setting item', () => {
    const item = { setting: { id: 'x', titleKey: 't', type: 'toggle' as const, default: true } }
    expect(isSettingItem(item)).toBe(true)
    expect(isGroupItem(item)).toBe(false)
  })

  it('narrows a group item', () => {
    const item = { group: { id: 'g', titleKey: 't', items: [] } }
    expect(isGroupItem(item)).toBe(true)
    expect(isSettingItem(item)).toBe(false)
  })
})
