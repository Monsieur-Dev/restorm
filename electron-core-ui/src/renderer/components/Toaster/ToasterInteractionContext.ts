import React from 'react'

export interface ToastInteractionState {
  /** True when the mouse is inside the toaster or focus is within it. */
  paused: boolean
}

export const ToasterInteractionContext = React.createContext<ToastInteractionState>({ paused: false })
