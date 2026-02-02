import React from 'react'
import './statusbar.css'
import { StatusbarProps } from './types'

const Statusbar: React.FC<StatusbarProps> = ({
  children,
  className = '',
  id,
  'data-testid': dataTestId
}) => {
  const testId = dataTestId ?? 'statusbar'
  const itemCount = React.Children.count(children)
  const statusbarClasses = [
    'statusbar',
    className
  ].filter(Boolean).join(' ')

  return (
    <div
      id={id}
      className={statusbarClasses}
      data-testid={testId}
      data-item-count={String(itemCount)}
    >
      {children}
    </div>
  )
}

export default Statusbar
