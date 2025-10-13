import React from 'react'
import './Controls.css'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  id?: string
  className?: string
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  id,
  className = ''
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.checked)
  }

  return (
    <label className={`checkbox-wrapper ${className}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="checkbox-input"
        checked={checked}
        onChange={handleChange}
      />
      <span className="checkbox-custom" />
      {label && <span className="checkbox-label">{label}</span>}
    </label>
  )
}

