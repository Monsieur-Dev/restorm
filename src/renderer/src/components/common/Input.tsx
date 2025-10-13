import React from 'react'
import './Controls.css'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'text' | 'number' | 'search'
}

export const Input: React.FC<InputProps> = ({ variant = 'text', className = '', ...props }) => {
  return (
    <input
      {...props}
      className={`input-field input-field--${variant} ${className}`}
    />
  )
}

