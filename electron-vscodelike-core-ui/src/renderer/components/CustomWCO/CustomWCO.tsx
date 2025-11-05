import React, { useState, useEffect } from 'react'
import './custom-wco.css'

export interface CustomWCOProps {
  className?: string
  platform?: string
}

const CustomWCO: React.FC<CustomWCOProps> = ({ 
  className = '', 
  platform 
}) => {
  const [currentPlatform, setCurrentPlatform] = useState<string>(platform ?? '')
  const [isMaximized, setIsMaximized] = useState(false)

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

  // Only show controls on Linux (where native WCO buttons are not available)
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
