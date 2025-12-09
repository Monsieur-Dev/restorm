import React, { useState, useEffect } from 'react'
import './custom-wco.css'

export interface CustomWCOProps {
  className?: string
  platform?: string
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
  platform 
}) => {
  const [currentPlatform, setCurrentPlatform] = useState<string>(platform ?? '')
  const [isMaximized, setIsMaximized] = useState(false)
  const [wcoWidth, setWcoWidth] = useState<number>(138) // Default Windows WCO width

  useEffect(() => {
    // Get platform from electronAPI if not provided as prop
    if (!platform && window.electronAPI?.onPlatform) {
      window.electronAPI.onPlatform((platform: string) => {
        setCurrentPlatform(platform)
      })
    } else if (platform) {
      setCurrentPlatform(platform)
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
      />
    )
  }

  // On other platforms (not Linux), return null
  if (currentPlatform !== 'linux') {
    return null
  }

  return (
    <div className={`custom-wco ${className}`}>
      <div className="window-controls-container">
        <div 
          className="window-button minimize" 
          onClick={handleMinimize}
          title="Minimize"
        >
          <span className="codicon codicon-chrome-minimize"></span>
        </div>
        <div 
          className="window-button maximize" 
          onClick={handleMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
        >
          <span className={`codicon ${isMaximized ? 'codicon-chrome-restore' : 'codicon-chrome-maximize'}`}></span>
        </div>
        <div 
          className="window-button close" 
          onClick={handleClose}
          title="Close"
        >
          <span className="codicon codicon-chrome-close"></span>
        </div>
      </div>
    </div>
  )
}

export default CustomWCO
