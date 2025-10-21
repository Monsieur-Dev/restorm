import React from 'react'
import Button from './Button'
import { ButtonWithDescriptionProps } from './types'

const ButtonWithDescription: React.FC<ButtonWithDescriptionProps> = ({
  options,
  label,
  description,
  icon,
  onClick,
  className = '',
  id
}) => {
  // Render icon if provided
  const renderIcon = () => {
    if (!icon) return null
    return <span className={`codicon codicon-${icon}`} />
  }

  // Render description with icon support
  const renderDescription = () => {
    if (!description) return null

    // Simple icon parsing - look for $(iconName) pattern
    const iconRegex = /\$\(([^)]+)\)/g
    const parts = description.split(iconRegex)
    
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        // This is an icon name
        return <span key={index} className={`codicon codicon-${part}`} />
      } else {
        // This is text
        return part
      }
    })
  }

  return (
    <div className={`monaco-description-button ${className}`} id={id}>
      <Button
        options={options}
        label={label}
        icon={icon}
        onClick={onClick}
        className="monaco-button-label"
      />
      <div className="monaco-button-description">
        {renderIcon()}
        {renderDescription()}
      </div>
    </div>
  )
}

export { ButtonWithDescription }
export default ButtonWithDescription
