import React from 'react'
import './rainbowButton.css'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/rainbow-button
// Tailwind utilities translated to plain CSS; CVA + Radix Slot dropped.

export type RainbowButtonSize = 'sm' | 'default' | 'lg' | 'xl'

export interface RainbowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: RainbowButtonSize
}

export const RainbowButton = React.forwardRef<HTMLButtonElement, RainbowButtonProps>(
  function RainbowButton({ className, size = 'default', children, ...props }, ref) {
    const classes = [
      'ecu-rainbow-button',
      `ecu-rainbow-button--${size}`,
      className
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    )
  }
)
