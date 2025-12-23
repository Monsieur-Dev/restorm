import React, { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import {
  KeyValueTable,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  type CellRendererProps,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { Handlebars } from '../../utils/handlebarsHelpers'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'

export type VariableContext = Record<string, string>

interface ResolvedKeyValue {
  key: string
  value: string
  description?: string | undefined
}

interface ResolvedSequence {
  contextsBeforeRow: VariableContext[]
  resolvedRows: ResolvedKeyValue[]
  finalContext: VariableContext
}

function compileTemplate(template: string): Handlebars.TemplateDelegate {
  return Handlebars.compile(template, { noEscape: true })
}

function resolveKeyValueSequence(rows: KeyValueTableRow[], baseContext: VariableContext): ResolvedSequence {
  let currentContext: VariableContext = { ...baseContext }
  const contextsBeforeRow: VariableContext[] = []
  const resolvedRows: ResolvedKeyValue[] = []

  for (const row of rows) {
    const contextSnapshot = { ...currentContext }
    contextsBeforeRow.push(contextSnapshot)

    let resolvedKey: string
    let resolvedValue: string

    try {
      const compileKey = compileTemplate(row.key)
      resolvedKey = compileKey(contextSnapshot)
    } catch {
      resolvedKey = row.key
    }

    try {
      const compileValue = compileTemplate(row.value)
      resolvedValue = compileValue(contextSnapshot)
    } catch {
      resolvedValue = row.value
    }

    if (resolvedKey) {
      currentContext = {
        ...currentContext,
        [resolvedKey]: resolvedValue
      }
    }

    resolvedRows.push({
      key: resolvedKey,
      value: resolvedValue,
      description: row.description
    })
  }

  return {
    contextsBeforeRow,
    resolvedRows,
    finalContext: currentContext
  }
}

export interface RestormKeyValueTableProps {
  /** Base variables visible to all rows (environment, folder, etc.) */
  variables: VariableDefinition[]
  /** Handlebars helpers for autocompletion */
  helpers?: TranslatedHelperDefinition[]
  /** Initial rows to populate the table */
  initialRows?: KeyValueTableRow[]
  /**
   * Visibility mode for variables inside this table:
   * - 'accumulated': each row sees base variables plus previous rows
   * - 'base-only': each row only sees base variables (no variables from previous rows)
   */
  visibilityMode?: 'accumulated' | 'base-only'
  /**
   * Optional callback receiving the final resolved context.
   */
  onResolvedContextChange?: (context: VariableContext) => void
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
    visibilityMode = 'accumulated',
    onResolvedContextChange,
    onRowsChange
  },
  ref
) => {
  const [rows, setRows] = useState<KeyValueTableRow[]>(initialRows ?? [])
  const lastFinalContextRef = useRef<VariableContext | null>(null)

  // Build base context from variables
  const baseContext: VariableContext = useMemo(() => {
    const ctx: VariableContext = {}
    for (const v of variables) {
      ctx[v.name] = v.value
    }
    return ctx
  }, [variables])

  // Resolve the sequence
  const sequence = useMemo(
    () => resolveKeyValueSequence(rows, baseContext),
    [rows, baseContext]
  )

  // Build context from resolved rows only
  const resolvedRowsContext = useMemo<VariableContext>(() => {
    const ctx: VariableContext = {}
    for (const resolvedRow of sequence.resolvedRows) {
      if (resolvedRow.key) {
        ctx[resolvedRow.key] = resolvedRow.value
      }
    }
    return ctx
  }, [sequence.resolvedRows])

  // Notify parent of resolved context when it changes
  useEffect(() => {
    if (!onResolvedContextChange) return

    const prevContext = lastFinalContextRef.current
    if (prevContext) {
      const prevKeys = Object.keys(prevContext)
      const nextKeys = Object.keys(resolvedRowsContext)
      if (prevKeys.length === nextKeys.length) {
        let changed = false
        for (const key of nextKeys) {
          if (prevContext[key] !== resolvedRowsContext[key]) {
            changed = true
            break
          }
        }
        if (!changed) return
      }
    }

    lastFinalContextRef.current = resolvedRowsContext
    onResolvedContextChange(resolvedRowsContext)
  }, [resolvedRowsContext, onResolvedContextChange])

  // Compute variables available based on visibility mode
  const effectiveVariables = useMemo<VariableDefinition[]>(() => {
    if (visibilityMode === 'base-only') {
      return variables
    }
    // accumulated mode: include base + resolved rows
    const allContext = { ...baseContext, ...resolvedRowsContext }
    return Object.entries(allContext).map(([name, value]) => ({ name, value }))
  }, [visibilityMode, variables, baseContext, resolvedRowsContext])

  const handleRowsChange = useCallback((newRows: KeyValueTableRow[]): void => {
    setRows(newRows)
    onRowsChange?.(newRows)
  }, [onRowsChange])

  // Create cell renderer that uses RestormVariableInputBox
  const VariableCellRenderer = useCallback<React.FC<CellRendererProps>>(
    ({ value, onChange }) => (
      <RestormVariableInputBox
        value={value}
        onChange={onChange}
        variables={effectiveVariables}
        helpers={helpers}
      />
    ),
    [effectiveVariables, helpers]
  )

  return (
    <KeyValueTable
      ref={ref}
      initialRows={initialRows}
      onRowsChange={handleRowsChange}
      renderKeyCell={VariableCellRenderer}
      renderValueCell={VariableCellRenderer}
    />
  )
})

RestormKeyValueTable.displayName = 'RestormKeyValueTable'
