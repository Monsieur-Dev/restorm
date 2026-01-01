import React from 'react'
import { usePlatform } from '../../hooks/usePlatform'
import '../../assets/workbench.css'

export interface WorkbenchProps {
  children: React.ReactNode
  className?: string
  border?: boolean
  fullscreen?: boolean
  fontAliasing?: 'auto' | 'antialiased' | 'none'
}

const Workbench: React.FC<WorkbenchProps> = ({
  children,
  className = '',
  border = false,
  fullscreen = false,
  fontAliasing = 'auto'
}) => {
  const { isMacintosh: isMac, isWindows, isLinux } = usePlatform()
  
  // Theme is managed by ThemeProvider (parent component)

  const classes = [
    'workbench',
    isMac && 'mac',
    isWindows && 'windows',
    isLinux && 'linux',
    border && 'border',
    fullscreen && 'fullscreen',
    isMac ? `font-aliasing-${fontAliasing}` : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} data-testid="workbench" data-ready="true">
      {children}
    </div>
  )
}

export default Workbench
