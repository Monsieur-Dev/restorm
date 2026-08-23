import type React from 'react'

/**
 * The generic diff-highlight framework half of the conflict-resolution
 * feature (see `ConflictResolutionView` for the shell half). Reuses the
 * SAME validation-error CSS var every other field-level error state in
 * the app already draws from (`NumberInput.tsx`'s `outOfRange` styling is
 * the existing precedent) rather than inventing a new "diff" color.
 *
 * Purely a style computation — no component wrapper, because every
 * protocol's field components (`InputBox`, key-value tables, body
 * editors, …) already accept a `style` prop the same way `NumberInput`
 * conditionally spreads one in; the host app computes `differs` per
 * field from its own entity-diff logic and spreads this in alongside its
 * existing style.
 */
export function fieldDiffStyle(differs: boolean): React.CSSProperties | undefined {
  return differs ? { borderColor: 'var(--inputValidation-errorBorder, #be1100)' } : undefined
}
