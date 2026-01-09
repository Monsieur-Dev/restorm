/**
 * Desktop indicator component for statusbar
 * Shows "Desktop" text when desktop-indicator feature is enabled
 */

import React from 'react'
import { StatusbarElement, useFeature } from 'electron-core-ui/renderer'

export const DesktopIndicator: React.FC = () => {
  const { isEnabled, isLoading } = useFeature('desktop-indicator')

  if (isLoading || !isEnabled) {
    return null
  }

  return <StatusbarElement title="Desktop" />
}

export default DesktopIndicator
