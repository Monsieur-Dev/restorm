import React from 'react'
import Button from './Button'
import { ButtonWithIconProps } from './types'

const ButtonWithIcon: React.FC<ButtonWithIconProps> = ({
  options,
  icon,
  label,
  onClick,
  className = '',
  id
}) => {
  // Combine icon and label into a single label with inline icon syntax
  const combinedLabel = icon ? `$(${icon}) ${label}` : label

  return (
    <Button
      options={options}
      label={combinedLabel}
      onClick={onClick}
      className={className}
      {...(id && { id })}
    />
  )
}

export { ButtonWithIcon }
export default ButtonWithIcon
