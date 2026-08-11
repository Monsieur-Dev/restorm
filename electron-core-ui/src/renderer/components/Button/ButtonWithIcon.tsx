import React from 'react'
import { Button } from './Button'
import { ButtonWithIconProps } from './types'

const ButtonWithIcon: React.FC<ButtonWithIconProps> = ({
  options,
  icon,
  label,
  onClick,
  className = '',
  id,
  'data-testid': dataTestId
}) => {
  // Combine icon and label into a single label with inline icon syntax
  const combinedLabel = icon ? `$(${icon}) ${label}` : label

  return (
    <Button
      options={options}
      onClick={onClick}
      className={className}
      {...(id && { id })}
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      {combinedLabel}
    </Button>
  )
}

const MemoizedButtonWithIcon = React.memo(ButtonWithIcon)
export { MemoizedButtonWithIcon as ButtonWithIcon }
