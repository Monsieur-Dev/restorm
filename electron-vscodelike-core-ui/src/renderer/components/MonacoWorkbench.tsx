import React from 'react'
import { usePlatform } from '../hooks/usePlatform'
import '../assets/monaco-workbench.css'

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
  const platform = usePlatform()

  const classes = [
    'monaco-workbench',
    platform,
    border && 'border',
    fullscreen && 'fullscreen',
    platform === 'mac' && fontAliasing && `monaco-font-aliasing-${fontAliasing}`,
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {children}
    </div>
  )
}

export default MonacoWorkbench

