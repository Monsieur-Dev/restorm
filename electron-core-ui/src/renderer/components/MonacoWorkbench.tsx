import React from 'react'
import { usePlatform } from '../hooks/usePlatform'
import '../assets/workbench.css'

export interface MonacoWorkbenchProps {
  children: React.ReactNode
  className?: string
  border?: boolean
  fullscreen?: boolean
  fontAliasing?: 'auto' | 'antialiased' | 'none'
}

const MonacoWorkbench: React.FC<MonacoWorkbenchProps> = ({
  children,
  className = '',
  border = false,
  fullscreen = false,
  fontAliasing = 'auto'
}) => {
  const { isMacintosh: isMac, isWindows, isLinux } = usePlatform()
  
  // Theme is managed by ThemeProvider (parent component)
  // No need to call useTheme() here

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
    <div className={classes}>
      {children}
    </div>
  )
}

export default MonacoWorkbench
