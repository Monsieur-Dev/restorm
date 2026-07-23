function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export type ConflictResolutionSide = 'user' | 'server' | 'resolved' | 'list'

/**
 * The `ConflictResolutionView` lays its panels out as side-by-side COLUMNS,
 * each carrying a stable side-based testid (`<root>-panel-<side>`). Scoping
 * by side is how a test reaches "the Resolved column" etc. — the SAME entity
 * view is rendered in all three version columns with IDENTICAL inner testids,
 * so the column testid is the only stable disambiguator.
 */
export function conflictResolutionPanelSelector(rootTestId: string, side: ConflictResolutionSide): string {
  return `[data-testid="${escapeAttributeValue(`${rootTestId}-panel-${side}`)}"]`
}
