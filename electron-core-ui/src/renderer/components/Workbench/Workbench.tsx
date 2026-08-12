import React from 'react'
import { usePlatform } from '../../hooks/usePlatform'
import '../../assets/workbench.css'

export interface WorkbenchProps {
  children: React.ReactNode
  className?: string
  border?: boolean
  fullscreen?: boolean
  fontAliasing?: 'auto' | 'antialiased' | 'none'
  'data-testid'?: string
}

const Workbench: React.FC<WorkbenchProps> = ({
  children,
  className = '',
  border = false,
  fullscreen = false,
  fontAliasing = 'auto',
  'data-testid': dataTestId
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

  const testId = dataTestId ?? 'workbench'
  const platform = isMac ? 'mac' : isWindows ? 'windows' : isLinux ? 'linux' : 'unknown'

  return (
    <div
      className={classes}
      data-testid={testId}
      data-ready="true"
      data-border={border ? 'true' : 'false'}
      data-fullscreen={fullscreen ? 'true' : 'false'}
      data-font-aliasing={fontAliasing}
      data-platform={platform}
    >
      {children}
    </div>
  )
}

export { Workbench }
