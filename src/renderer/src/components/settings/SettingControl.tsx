import React, { useCallback } from 'react'
import {
  SettingDefinition,
  BooleanSettingDefinition,
  NumberSettingDefinition,
  StringSettingDefinition,
  EnumSettingDefinition,
  RangeSettingDefinition,
  SettingType
} from '../../types/settings.types'
import { CustomSelect } from './CustomSelect'

interface SettingControlProps {
  setting: SettingDefinition
  value: unknown
  onChange: (value: unknown) => void
}

export const SettingControl: React.FC<SettingControlProps> = ({ setting, value, onChange }) => {
  switch (setting.type) {
    case SettingType.BOOLEAN:
      return <BooleanControl setting={setting} value={value as boolean} onChange={onChange} />
    case SettingType.NUMBER:
      return <NumberControl setting={setting} value={value as number} onChange={onChange} />
    case SettingType.STRING:
      return <StringControl setting={setting} value={value as string} onChange={onChange} />
    case SettingType.ENUM:
      return <EnumControl setting={setting} value={value as string} onChange={onChange} />
    case SettingType.RANGE:
      return <RangeControl setting={setting} value={value as number} onChange={onChange} />
    default:
      return <div>Unknown setting type</div>
  }
}

// Boolean Control (Toggle)
interface BooleanControlProps {
  setting: BooleanSettingDefinition
  value: boolean | undefined
  onChange: (value: boolean) => void
}

const BooleanControl: React.FC<BooleanControlProps> = ({ setting, value, onChange }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.checked)
    },
    [onChange]
  )

  const checkedValue = value ?? setting.defaultValue

  return (
    <div className="setting-control setting-control--boolean">
      <label className="setting-control__checkbox-label">
        <input
          type="checkbox"
          className="setting-control__checkbox"
          checked={checkedValue}
          onChange={handleChange}
        />
        <span className="setting-control__checkbox-custom" />
      </label>
    </div>
  )
}

// Number Control
interface NumberControlProps {
  setting: NumberSettingDefinition
  value: number | undefined
  onChange: (value: number) => void
}

const NumberControl: React.FC<NumberControlProps> = ({ setting, value, onChange }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseFloat(e.target.value)
      if (!isNaN(newValue)) {
        onChange(newValue)
      }
    },
    [onChange]
  )

  const displayValue = value ?? setting.defaultValue

  return (
    <div className="setting-control setting-control--number">
      <input
        type="number"
        className="setting-control__input"
        value={displayValue}
        onChange={handleChange}
      />
    </div>
  )
}

// String Control
interface StringControlProps {
  setting: StringSettingDefinition
  value: string | undefined
  onChange: (value: string) => void
}

const StringControl: React.FC<StringControlProps> = ({ setting, value, onChange }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value)
    },
    [onChange]
  )

  const displayValue = value ?? setting.defaultValue

  return (
    <div className="setting-control setting-control--string">
      <input
        type="text"
        className="setting-control__input"
        value={displayValue}
        onChange={handleChange}
      />
    </div>
  )
}

// Enum Control (Dropdown)
interface EnumControlProps {
  setting: EnumSettingDefinition
  value: string | undefined
  onChange: (value: string) => void
}

const EnumControl: React.FC<EnumControlProps> = ({ setting, value, onChange }) => {
  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue)
    },
    [onChange]
  )

  const selectedValue = value ?? setting.defaultValue

  return (
    <div className="setting-control setting-control--enum">
      <CustomSelect
        value={selectedValue}
        options={setting.options}
        onChange={handleChange}
      />
    </div>
  )
}

// Range Control (Slider)
interface RangeControlProps {
  setting: RangeSettingDefinition
  value: number | undefined
  onChange: (value: number) => void
}

const RangeControl: React.FC<RangeControlProps> = ({ setting, value, onChange }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseFloat(e.target.value)
      onChange(newValue)
    },
    [onChange]
  )

  const currentValue = value ?? setting.defaultValue

  return (
    <div className="setting-control setting-control--range">
      <div className="setting-control__range-container">
        <input
          type="range"
          className="setting-control__slider"
          min={setting.min}
          max={setting.max}
          step={setting.step ?? 1}
          value={currentValue}
          onChange={handleChange}
        />
        <span className="setting-control__range-value">{currentValue}</span>
      </div>
      <div className="setting-control__range-labels">
        <span className="setting-control__range-label">{setting.min}</span>
        <span className="setting-control__range-label">{setting.max}</span>
      </div>
    </div>
  )
}

