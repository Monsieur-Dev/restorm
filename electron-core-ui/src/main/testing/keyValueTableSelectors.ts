function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function attributeSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function keyValueTableRootSelector(tableId: string): string {
  return attributeSelector(tableId)
}

export function keyValueTableTableSelector(tableId: string): string {
  return attributeSelector(`${tableId}-table`)
}

/**
 * The row `<tr>`. It is emitted by the inner `Table`, whose own test id is
 * `<tableId>-table`, so the row id lands under `-table-row-` and not `-row-`.
 * The cell ids below are emitted by `KeyValueTable` itself and therefore do NOT
 * carry that extra segment — the asymmetry is real, not a typo, and it is the
 * reason to compose these helpers rather than write the strings by hand.
 */
export function keyValueTableRowTestId(tableId: string, rowId: string): string {
  return `${tableId}-table-row-${rowId}`
}

export function keyValueTableRowSelector(tableId: string, rowId: string): string {
  return attributeSelector(keyValueTableRowTestId(tableId, rowId))
}

/**
 * The test id handed to the KEY cell's renderer. The default renderer is an
 * `InputBox`, which derives its own ids from this one — pair it with
 * `inputBoxInputSelector` to reach the actual `<input>`, which is where a test
 * types.
 */
export function keyValueTableRowKeyCellTestId(tableId: string, rowId: string): string {
  return `${tableId}-row-${rowId}-key`
}

export function keyValueTableRowKeyCellSelector(tableId: string, rowId: string): string {
  return attributeSelector(keyValueTableRowKeyCellTestId(tableId, rowId))
}

/** The test id handed to the VALUE cell's renderer. See {@link keyValueTableRowKeyCellTestId}. */
export function keyValueTableRowValueCellTestId(tableId: string, rowId: string): string {
  return `${tableId}-row-${rowId}-value`
}

export function keyValueTableRowValueCellSelector(tableId: string, rowId: string): string {
  return attributeSelector(keyValueTableRowValueCellTestId(tableId, rowId))
}

/** The test id handed to the DESCRIPTION cell's renderer. See {@link keyValueTableRowKeyCellTestId}. */
export function keyValueTableRowDescriptionCellTestId(tableId: string, rowId: string): string {
  return `${tableId}-row-${rowId}-description`
}

export function keyValueTableRowDescriptionCellSelector(tableId: string, rowId: string): string {
  return attributeSelector(keyValueTableRowDescriptionCellTestId(tableId, rowId))
}

export function keyValueTableRowEnabledToggleSelector(tableId: string, rowId: string): string {
  return attributeSelector(`${tableId}-row-${rowId}-enabled`)
}

export function keyValueTableRowDeleteSelector(tableId: string, rowId: string): string {
  return attributeSelector(`${tableId}-row-${rowId}-delete`)
}

/** The row's drag grip. Emitted by the inner `Table` — see {@link keyValueTableRowTestId}. */
export function keyValueTableRowDragHandleTestId(tableId: string, rowId: string): string {
  return `${tableId}-table-drag-${rowId}`
}

export function keyValueTableRowDragHandleSelector(tableId: string, rowId: string): string {
  return attributeSelector(keyValueTableRowDragHandleTestId(tableId, rowId))
}
