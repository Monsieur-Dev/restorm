import type { ResolvedSetting, SettingValue } from '../../../../types/settings'

export interface SettingRendererProps {
  setting: ResolvedSetting
  value: SettingValue
  onChange: (v: SettingValue) => void
}
