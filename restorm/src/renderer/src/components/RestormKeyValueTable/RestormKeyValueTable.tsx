import React, { useCallback, useRef, useEffect } from 'react'
import {
  KeyValueTable,
  InputBox,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  type CellRendererProps,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'

export type VariableContext = Record<string, string>

export interface RestormKeyValueTableProps {
  /** Base variables visible to all rows (environment, folder, etc.) */
  variables: VariableDefinition[]
  /** Handlebars helpers for autocompletion */
  helpers?: TranslatedHelperDefinition[]
  /** Initial rows to populate the table */
  initialRows?: KeyValueTableRow[]
  /**
   * Optional callback when rows change (for persisting edits).
   */
  onRowsChange?: (rows: KeyValueTableRow[]) => void
}

export const RestormKeyValueTable = React.forwardRef<KeyValueTableHandle, RestormKeyValueTableProps>((
  {
    variables,
    helpers = [],
    initialRows,
    onRowsChange
  },
  ref
) => {
  // Keep refs to avoid recreating cell renderers
  const variablesRef = useRef(variables)
  const helpersRef = useRef(helpers)
  
  // Update refs via useEffect to avoid accessing during render
  useEffect(() => {
    variablesRef.current = variables
  }, [variables])
  
  useEffect(() => {
    helpersRef.current = helpers
  }, [helpers])

  // Simple InputBox renderer for keys (no variable resolution needed for keys)
  const KeyCellRenderer = useCallback<React.FC<CellRendererProps>>(
    ({ value, onChange }) => (
      <InputBox
        value={value}
        onChange={onChange}
        options={{ type: 'text' }}
      />
    ),
    []
  )

  // RestormVariableInputBox renderer for values (with resolved value tooltips)
  // Use refs to avoid recreating the renderer when variables/helpers change
  const ValueCellRenderer = useCallback<React.FC<CellRendererProps>>(
    ({ value, onChange, rowId }) => (
      <RestormVariableInputBox
        value={value}
        onChange={onChange}
        variables={variablesRef.current}
        helpers={helpersRef.current}
        variableId={rowId}
      />
    ),
    [] // No dependencies - uses refs instead
  )

  return (
    <KeyValueTable
      ref={ref}
      initialRows={initialRows}
      onRowsChange={onRowsChange}
      renderKeyCell={KeyCellRenderer}
      renderValueCell={ValueCellRenderer}
    />
  )
})

RestormKeyValueTable.displayName = 'RestormKeyValueTable'
