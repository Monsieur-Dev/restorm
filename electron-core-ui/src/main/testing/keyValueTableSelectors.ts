function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function keyValueTableRootSelector(tableId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}"]`
}

export function keyValueTableTableSelector(tableId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-table"]`
}

export function keyValueTableRowSelector(tableId: string, rowId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-row-${escapeAttributeValue(rowId)}"]`
}

export function keyValueTableRowKeyCellSelector(tableId: string, rowId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-row-${escapeAttributeValue(rowId)}-key"]`
}

export function keyValueTableRowValueCellSelector(tableId: string, rowId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-row-${escapeAttributeValue(rowId)}-value"]`
}

export function keyValueTableRowDescriptionCellSelector(tableId: string, rowId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-row-${escapeAttributeValue(rowId)}-description"]`
}

export function keyValueTableRowEnabledToggleSelector(tableId: string, rowId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-row-${escapeAttributeValue(rowId)}-enabled"]`
}

export function keyValueTableRowDeleteSelector(tableId: string, rowId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-row-${escapeAttributeValue(rowId)}-delete"]`
}

export function keyValueTableRowDragHandleSelector(tableId: string, rowId: string): string {
  return `[data-testid="${escapeAttributeValue(tableId)}-row-${escapeAttributeValue(rowId)}-drag"]`
}
