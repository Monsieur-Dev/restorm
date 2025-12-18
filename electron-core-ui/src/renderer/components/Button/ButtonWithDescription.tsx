import React from 'react'
import Button from './Button'
import { ButtonWithDescriptionProps } from './types'

const ButtonWithDescription: React.FC<ButtonWithDescriptionProps> = ({
  options = {},
  description,
  icon,
  onClick,
  className = '',
  id,
  children
}) => {
  // Render icon if provided
  const renderIcon = (): JSX.Element | null => {
    if (!icon) return null
    return <span className={`codicon codicon-${icon}`} />
  }

  // Render description with icon support
  const renderDescription = (): React.ReactNode => {
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
    <div className={`description-button ${className}`} id={id}>
      <Button
        options={options}
        icon={icon}
        onClick={onClick}
        className="button-label"
      >
        {children}
      </Button>
      <div className="button-description">
        {renderIcon()}
        {renderDescription()}
      </div>
    </div>
  )
}

export { ButtonWithDescription }
export default ButtonWithDescription
