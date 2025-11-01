import React, { useEffect, useState } from 'react'
import './titlebar.css'
import { TitlebarProps } from './types'
import { CustomWCO } from '../CustomWCO'

const Titlebar: React.FC<TitlebarProps> = ({
  icon,
  title,
  leftContent,
  rightContent,
  centerContent,
  children,  // Deprecated: use leftContent instead
  className = '',
  id
}) => {
  const titlebarClasses = [
    'titlebar',
    className
  ].filter(Boolean).join(' ')

  // State for app icon
  const [appIconPath, setAppIconPath] = useState<string | undefined>(undefined)

  // Fetch app icon if no custom icon is provided
  useEffect(() => {
    if (!icon && typeof window !== 'undefined' && window.api?.getWindowIcon) {
      window.api.getWindowIcon().then((path) => {
        setAppIconPath(path)
      }).catch(() => {
        // Ignore errors when fetching app icon
      })
    }
  }, [icon])

  // Render icon
  const renderIcon = () => {
    const actualIcon = icon || appIconPath
    if (!actualIcon) return null
    
    if (typeof actualIcon === 'string') {
      if (actualIcon.trim() === '') return null
      return <img src={actualIcon} alt="" className="titlebar-icon" />
    }
    
    return <div className="titlebar-icon">{actualIcon}</div>
  }

  // Use leftContent if provided, otherwise fall back to children for backward compatibility
  const actualLeftContent = leftContent ?? children

  return (
    <div
      id={id}
      className={titlebarClasses}
      style={{
        width: '100%',
        height: '30px',
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box'
      }}
    >
      {/* Left zone */}
      <div className="titlebar-left">
        {renderIcon()}
        {actualLeftContent}
      </div>
      
      {/* Center zone */}
      <div className="titlebar-center">
        {centerContent || <span className="titlebar-title">{title}</span>}
      </div>
      
      {/* Right zone */}
      <div className="titlebar-right">
        {rightContent}
      </div>
      
      <CustomWCO />
    </div>
  )
}

export default Titlebar
