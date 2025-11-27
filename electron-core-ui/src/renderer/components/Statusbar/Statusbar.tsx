import React from 'react'
import './statusbar.css'
import { StatusbarProps } from './types'

const Statusbar: React.FC<StatusbarProps> = ({
  children,
  className = '',
  id
}) => {
  const statusbarClasses = [
    'statusbar',
    className
  ].filter(Boolean).join(' ')

  return (
    <div
      id={id}
      className={statusbarClasses}
    >
      {children}
    </div>
  )
}

export default Statusbar

