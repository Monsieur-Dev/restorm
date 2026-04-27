/**
 * Inline confirmation rendered above an HTTP-style request tab when
 * smart-paste detects a `curl` command on the clipboard. Two
 * affordances: "Replace request" applies the parsed transport fields,
 * "Cancel" dismisses the prompt and leaves the current request alone.
 *
 * The `firstAccept` flag is what `useCurlPaste` flips on first apply —
 * this component never tracks state on its own; the host provides
 * `confirm` / `cancel` via the hook's `pendingPaste` slice.
 */

import React from 'react'
import { Button, Callout } from 'electron-core-ui/renderer'

export interface CurlPasteCalloutProps {
  /** Called when the user clicks "Replace request". */
  readonly onConfirm: () => void
  /** Called when the user clicks "Cancel" or dismisses. */
  readonly onCancel: () => void
  /** Test id forwarded to the underlying `Callout`. */
  readonly 'data-testid'?: string
}

export const CurlPasteCallout: React.FC<CurlPasteCalloutProps> = ({
  onConfirm,
  onCancel,
  'data-testid': dataTestId
}) => {
  return (
    <Callout
      variant="info"
      message="Detected a curl command on the clipboard. Replace the current request with its parsed values?"
      {...(dataTestId !== undefined && { 'data-testid': dataTestId })}
      actions={
        // Default-sized buttons with text. The `small` modifier on
        // `<Button>` is reserved for icon-only toolbar squares (20×20)
        // and clips text labels — leave it off here so the labels
        // render in full.
        <>
          <Button
            onClick={onConfirm}
            {...(dataTestId !== undefined && { 'data-testid': `${dataTestId}-confirm` })}
          >
            Replace request
          </Button>
          <Button
            secondary
            onClick={onCancel}
            {...(dataTestId !== undefined && { 'data-testid': `${dataTestId}-cancel` })}
          >
            Cancel
          </Button>
        </>
      }
    />
  )
}
