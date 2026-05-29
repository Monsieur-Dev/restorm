import type { ValueTypeName } from '../types/valueTypes/BaseValueType'
import type { ValueType } from '../types/collections'
import { DateTimeValue, NumericValue, PasswordValue, StringValue, ColorValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue, VariableValue, EnvironmentValue } from '../types/collections'

export type PersistedValue =
  | { type: 'string'; value: string }
  | { type: 'color'; value: string }
  | { type: 'numeric'; value: number; format: string }
  | { type: 'datetime'; value: string; format: string }
  | { type: 'password' }
  | { type: 'expression'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'enum'; value: string; enumDefinitionId: string }
  | { type: 'enumList'; value: string[]; enumDefinitionId: string }
  | { type: 'customList'; listId: string; label: string }
  | { type: 'customListMulti'; listId: string; labels: string[] }
  | { type: 'variable'; value: string }
  | { type: 'environment'; value: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValueTypeName(value: unknown): value is ValueTypeName {
  return value === 'string' || value === 'color' || value === 'numeric' || value === 'datetime' || value === 'password' || value === 'expression' || value === 'boolean' || value === 'enum' || value === 'enumList' || value === 'customList' || value === 'customListMulti' || value === 'variable' || value === 'environment'
}

/**
 * Convert any ValueType (or legacy raw value) into a persisted object structure.
 * - PasswordValue is persisted without its actual value.
 * - DateTimeValue is persisted as ISO string to avoid Date serialization ambiguity.
 */
export function serializeValueForPersistence(value: unknown): PersistedValue {
  if (value instanceof PasswordValue) {
    return { type: 'password' }
  }
  if (value instanceof NumericValue) {
    return { type: 'numeric', value: value.value, format: value.format }
  }
  if (value instanceof DateTimeValue) {
    return { type: 'datetime', value: value.value.toISOString(), format: value.format }
  }
  if (value instanceof ColorValue) {
    return { type: 'color', value: value.value }
  }
  if (value instanceof ExpressionValue) {
    return { type: 'expression', value: value.value }
  }
  if (value instanceof VariableValue) {
    return { type: 'variable', value: value.value }
  }
  if (value instanceof EnvironmentValue) {
    return { type: 'environment', value: value.value }
  }
  if (value instanceof BooleanValue) {
    return { type: 'boolean', value: value.value }
  }
  if (value instanceof EnumValue) {
    return { type: 'enum', value: value.value, enumDefinitionId: value.enumDefinitionId }
  }
  if (value instanceof EnumListValue) {
    return { type: 'enumList', value: value.value, enumDefinitionId: value.enumDefinitionId }
  }
  if (value instanceof CustomListValue) {
    return { type: 'customList', listId: value.listId, label: value.label }
  }
  if (value instanceof CustomListMultiValue) {
    return { type: 'customListMulti', listId: value.listId, labels: value.labels }
  }
  if (value instanceof StringValue) {
    return { type: 'string', value: value.value }
  }

  // If value is already in persisted object form, normalize and enforce password stripping.
  if (isRecord(value)) {
    const existingType = (value as { type?: unknown }).type
    if (!isValueTypeName(existingType)) {
      // fall through
    } else {
      const type = existingType
    if (type === 'password') return { type: 'password' }
    if (type === 'numeric') {
      const raw = (value as { value?: unknown }).value
      const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
      const format = (value as { format?: unknown }).format
      return { type: 'numeric', value: Number.isFinite(num) ? num : 0, format: typeof format === 'string' ? format : 'decimal' }
    }
    if (type === 'datetime') {
      const raw = (value as { value?: unknown }).value
      const d = raw instanceof Date ? raw : typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : new Date()
      const format = (value as { format?: unknown }).format
      return { type: 'datetime', value: d.toISOString(), format: typeof format === 'string' ? format : 'yyyy-MM-dd HH:mm:ss' }
    }
    if (type === 'color') {
      const raw = (value as { value?: unknown }).value
      return { type: 'color', value: typeof raw === 'string' ? raw : '' }
    }
    if (type === 'expression') {
      const raw = (value as { value?: unknown }).value
      return { type: 'expression', value: typeof raw === 'string' ? raw : '' }
    }
    if (type === 'variable') {
      const raw = (value as { value?: unknown }).value
      return { type: 'variable', value: typeof raw === 'string' ? raw : '' }
    }
    if (type === 'environment') {
      const raw = (value as { value?: unknown }).value
      return { type: 'environment', value: typeof raw === 'string' ? raw : '' }
    }
    if (type === 'boolean') {
      const raw = (value as { value?: unknown }).value
      return { type: 'boolean', value: raw === true || raw === 'true' }
    }
    if (type === 'enum') {
      const raw = (value as { value?: unknown }).value
      const defId = (value as { enumDefinitionId?: unknown }).enumDefinitionId
      return { type: 'enum', value: typeof raw === 'string' ? raw : '', enumDefinitionId: typeof defId === 'string' ? defId : '' }
    }
    if (type === 'enumList') {
      const raw = (value as { value?: unknown }).value
      const defId = (value as { enumDefinitionId?: unknown }).enumDefinitionId
      return { type: 'enumList', value: Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [], enumDefinitionId: typeof defId === 'string' ? defId : '' }
    }
    if (type === 'customList') {
      const listId = (value as { listId?: unknown }).listId
      const label = (value as { label?: unknown }).label
      return { type: 'customList', listId: typeof listId === 'string' ? listId : '', label: typeof label === 'string' ? label : '' }
    }
    if (type === 'customListMulti') {
      const listId = (value as { listId?: unknown }).listId
      const labels = (value as { labels?: unknown }).labels
      return { type: 'customListMulti', listId: typeof listId === 'string' ? listId : '', labels: Array.isArray(labels) ? labels.filter((v): v is string => typeof v === 'string') : [] }
    }
    const raw = (value as { value?: unknown }).value
    return { type: 'string', value: typeof raw === 'string' ? raw : '' }
    }
  }

  // Legacy scalar: assume string
  if (typeof value === 'string') return { type: 'string', value }
  if (typeof value === 'number') return { type: 'string', value: String(value) }
  if (typeof value === 'boolean') return { type: 'string', value: value ? 'true' : 'false' }
  if (value === null || value === undefined) return { type: 'string', value: '' }
  return { type: 'string', value: '' }
}

/**
 * Walk an arbitrary persisted document and ensure every KeyValue-like object
 * uses the persisted Value shape: { type, ... }.
 *
 * KeyValue-like is detected as an object with string `key` and a `value` property.
 * This function MUTATES the input object.
 */
export function normalizeDocumentValuesForPersistence(root: unknown): void {
  if (Array.isArray(root)) {
    for (const item of root) normalizeDocumentValuesForPersistence(item)
    return
  }
  if (!isRecord(root)) return

  // If it looks like a KeyValue, normalize its value
  const maybeKv = root as { key?: unknown; value?: unknown }
  if (typeof maybeKv.key === 'string' && 'value' in root) {
    maybeKv.value = serializeValueForPersistence(maybeKv.value)
  }

  for (const value of Object.values(root)) {
    normalizeDocumentValuesForPersistence(value)
  }
}

// Convenience for typed call sites
export function normalizeValueTypeForPersistence(value: ValueType): PersistedValue {
  return serializeValueForPersistence(value)
}
