import type { ValueType, CustomValueList } from '../../../../shared/types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue } from '../../../../shared/types/collections'
import { isPasswordValue, isNumericValue, isDateTimeValue, isColorValue, isExpressionValue, isBooleanValue, isEnumValue, isEnumListValue, isCustomListValue, isCustomListMultiValue } from '../../../../shared/utils/valueHelpers'
import { isHexColorString, tryParseDateString, tryParseNumberString } from '../../../../shared/utils/valueCasting'

export type ValueTypeKind =
  | 'string'
  | 'secret'
  | 'number'
  | 'dateTime'
  | 'color'
  | 'expression'
  | 'boolean'
  | 'enum'
  | 'enumList'
  | 'customList'
  | 'customListMulti'

/** Map a concrete ValueType instance to its UI kind discriminator. */
export function resolveValueTypeKind(value: ValueType | undefined): ValueTypeKind {
  if (!value) return 'string'
  if (isPasswordValue(value)) return 'secret'
  if (isNumericValue(value)) return 'number'
  if (isDateTimeValue(value)) return 'dateTime'
  if (isColorValue(value)) return 'color'
  if (isExpressionValue(value)) return 'expression'
  if (isBooleanValue(value)) return 'boolean'
  if (isEnumValue(value)) return 'enum'
  if (isEnumListValue(value)) return 'enumList'
  if (isCustomListMultiValue(value)) return 'customListMulti'
  if (isCustomListValue(value)) return 'customList'
  return 'string'
}

/**
 * Pure value-cast used by the type-pick menu: produce a fresh ValueType of
 * `targetKind` seeded from `current.toString()`, optionally bound to an enum
 * definition / custom value list by `defId`.
 *
 * For custom lists the current display label (if still an enabled entry of
 * the target list) is preserved; otherwise it defaults to the first enabled
 * entry so the dropdown shows a valid selection.
 */
export function castValueToKind(
  current: ValueType,
  targetKind: ValueTypeKind,
  defId?: string,
  customValueLists?: CustomValueList[]
): ValueType {
  const raw = current.toString()

  switch (targetKind) {
    case 'customList': {
      const listId = defId ?? ''
      const list = customValueLists?.find((l) => l.id === listId)
      const enabledEntries = (list?.entries ?? []).filter((e) => e.enabled !== false)
      const label = enabledEntries.some((e) => e.label === raw)
        ? raw
        : enabledEntries[0]?.label ?? ''
      return new CustomListValue(listId, label)
    }
    case 'customListMulti': {
      const listId = defId ?? ''
      const list = customValueLists?.find((l) => l.id === listId)
      const enabledLabels = (list?.entries ?? []).filter((e) => e.enabled !== false).map((e) => e.label)
      const currentLabels = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
      const labels = currentLabels.filter((l) => enabledLabels.includes(l))
      return new CustomListMultiValue(listId, labels)
    }
    case 'string':
      return new StringValue(raw)
    case 'secret':
      return new PasswordValue(raw)
    case 'number': {
      const parsed = tryParseNumberString(raw.trim())
      return new NumericValue(parsed ?? 0, 'decimal')
    }
    case 'dateTime': {
      const parsed = tryParseDateString(raw.trim())
      return new DateTimeValue(parsed ?? new Date(), 'yyyy-MM-dd HH:mm:ss')
    }
    case 'color': {
      const trimmed = raw.trim()
      const color = isHexColorString(trimmed) ? trimmed : '#000000'
      return new ColorValue(color)
    }
    case 'expression':
      return new ExpressionValue(raw)
    case 'boolean': {
      const asBool = raw.trim().toLowerCase() === 'true' || raw.trim() === '1'
      return new BooleanValue(asBool)
    }
    case 'enum':
      return new EnumValue(raw, defId ?? '')
    case 'enumList':
      return new EnumListValue(raw ? raw.split(',').map((s) => s.trim()) : [], defId ?? '')
    default:
      return new StringValue(raw)
  }
}
