import type React from 'react'
import type { VariableDefinition } from '../VariableInputBox'

export type InputTableColumnType = 'text' | 'checkbox' | 'variable'

export interface InputTableColumn {
  id: string
  label?: string
  type: InputTableColumnType
  width?: number | string
}

export type InputTableRow = Record<string, string | boolean>

export interface InputTableProps {
  columns: InputTableColumn[]
  rows: InputTableRow[]
  onChange: (rows: InputTableRow[]) => void
  createEmptyRow: () => InputTableRow
  getVariablesForColumn?: (columnId: string, row: InputTableRow, rowIndex: number) => VariableDefinition[]
  className?: string
  style?: React.CSSProperties
}


