import React from 'react'

export interface StatusbarProps {
  children?: React.ReactNode
  className?: string
  id?: string
}

export interface StatusbarElementProps {
  title: string | React.ReactNode
  warning?: boolean
  error?: boolean
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  className?: string
  id?: string
  children?: React.ReactNode
}

