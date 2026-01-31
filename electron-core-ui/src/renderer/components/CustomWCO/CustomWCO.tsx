import React, { useState, useEffect } from 'react'
import './custom-wco.css'

export interface CustomWCOProps {
  className?: string
  platform?: string
  /** Optional test id applied to the root element. */
  'data-testid'?: string
}

// Extend Navigator type for windowControlsOverlay API
interface WindowControlsOverlay {
  visible: boolean
  getTitlebarAreaRect: () => DOMRect
}

interface NavigatorWithWCO extends Navigator {
  windowControlsOverlay?: WindowControlsOverlay
}

const CustomWCO: React.FC<CustomWCOProps> = ({ 
  className = '', 
  platform,
  'data-testid': dataTestId
}) => {
  // Track async platform detection separately
  const [asyncPlatform, setAsyncPlatform] = useState<string>('')
  const [isMaximized, setIsMaximized] = useState(false)
  const [wcoWidth, setWcoWidth] = useState<number>(138) // Default Windows WCO width

  // Effective platform: use prop if provided, otherwise async-detected
  const currentPlatform = platform ?? asyncPlatform

  useEffect(() => {
    // Get platform from electronAPI if not provided as prop
    if (!platform && window.electronAPI?.onPlatform) {
      window.electronAPI.onPlatform((detectedPlatform: string) => {
        setAsyncPlatform(detectedPlatform)
      })
    }
  }, [platform])

  useEffect(() => {
    // Listen for window state changes
    if (window.electronAPI?.onWindowState) {
      window.electronAPI.onWindowState((state: string) => {
        setIsMaximized(state === 'maximized')
      })
    }
  }, [])

  // Calculate WCO width from native API if available
  useEffect(() => {
    const nav = navigator as NavigatorWithWCO
    if (!nav.windowControlsOverlay?.visible) {
      return
    }

    const updateWcoWidth = (): void => {
      const rect = nav.windowControlsOverlay?.getTitlebarAreaRect()
      if (rect) {
        // WCO width = window width - titlebar area width - titlebar area x
        const controlsWidth = window.innerWidth - rect.width - rect.x
        if (controlsWidth > 0) {
          setWcoWidth(controlsWidth)
        }
      }
    }
    
    updateWcoWidth()
    window.addEventListener('resize', updateWcoWidth)
    return () => { window.removeEventListener('resize', updateWcoWidth) }
  }, [currentPlatform])

  const handleMinimize = (): void => {
    if (window.electronAPI?.sendAction) {
      window.electronAPI.sendAction('minimize')
    }
  }

  const handleMaximize = (): void => {
    if (window.electronAPI?.sendAction) {
      window.electronAPI.sendAction('maximize')
    }
  }

  const handleClose = (): void => {
    if (window.electronAPI?.sendAction) {
      window.electronAPI.sendAction('close')
    }
  }

  // On Windows/macOS, return a spacer div to reserve space for native WCO
  if (currentPlatform === 'win32' || currentPlatform === 'darwin') {
    return (
      <div 
        className={`custom-wco-spacer ${className}`}
        style={{ 
          width: wcoWidth, 
          height: '100%',
          flexShrink: 0
        }}
        {...(dataTestId && { 'data-testid': dataTestId })}
      />
    )
  }

  // On other platforms (not Linux), return null
  if (currentPlatform !== 'linux') {
    return null
  }

  return (
    <div className={`custom-wco ${className}`} {...(dataTestId && { 'data-testid': dataTestId })}>
      <div className="window-controls-container">
        <div 
          className="window-button minimize" 
          onClick={handleMinimize}
          title="Minimize"
          {...(dataTestId && { 'data-testid': `${dataTestId}-minimize` })}
        >
          <span className="codicon codicon-chrome-minimize"></span>
        </div>
        <div 
          className="window-button maximize" 
          onClick={handleMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
          {...(dataTestId && { 'data-testid': `${dataTestId}-maximize` })}
        >
          <span className={`codicon ${isMaximized ? 'codicon-chrome-restore' : 'codicon-chrome-maximize'}`}></span>
        </div>
        <div 
          className="window-button close" 
          onClick={handleClose}
          title="Close"
          {...(dataTestId && { 'data-testid': `${dataTestId}-close` })}
        >
          <span className="codicon codicon-chrome-close"></span>
        </div>
      </div>
    </div>
  )
}

export default CustomWCO
