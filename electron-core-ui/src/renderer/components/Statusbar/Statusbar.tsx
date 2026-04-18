import React, { useEffect } from 'react'
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

  // Expose the statusbar height on document.body so other components
  // (e.g. Toaster) can anchor themselves above the bar without
  // hard-coding the value. Matches the 22px height in statusbar.css.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.style.setProperty('--statusbar-height', '22px')
    return () => {
      document.body.style.removeProperty('--statusbar-height')
    }
  }, [])

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
