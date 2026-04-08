import React, { useEffect, useState } from 'react'
import { Button } from '../Button'
import { navigationService } from '../../services/NavigationService'

interface NavigationButtonsProps {
  'data-testid'?: string
}

const NavigationButtons: React.FC<NavigationButtonsProps> = ({
  'data-testid': dataTestId
}) => {
  const testId = dataTestId ?? 'navigation-buttons'
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  useEffect(() => {
    const unsubscribe = navigationService.onHistoryStateChange(
      (back, forward) => {
        setCanGoBack(back)
        setCanGoForward(forward)
      }
    )
    return unsubscribe
  }, [])

  return (
    <div className="titlebar-navigation-buttons" data-testid={testId}>
      <Button
        small
        secondary
        icon="arrow-left"
        disabled={!canGoBack}
        onClick={() => { navigationService.goBack() }}
        data-testid={`${testId}-back`}
      />
      <Button
        small
        secondary
        icon="arrow-right"
        disabled={!canGoForward}
        onClick={() => { navigationService.goForward() }}
        data-testid={`${testId}-forward`}
      />
    </div>
  )
}

export { NavigationButtons }
export default NavigationButtons
