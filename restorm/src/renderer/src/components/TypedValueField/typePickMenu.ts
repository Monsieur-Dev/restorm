/** Minimal structural shape of a type-pick context-menu node (compatible with
 * the ECUI `ContextMenuItem`). Kept dependency-free so it's unit-testable in a
 * plain node env. */
export interface TypeMenuNode {
  id?: string
  isSeparator?: boolean
  items?: TypeMenuNode[]
  onClick?: () => void
  checked?: boolean
}

/** Flatten the type-pick menu to its selectable TYPE leaves (recursing into the
 * API / Variables submenus), excluding separators and the non-type `remove`
 * action. Drives "only one type possible → hide the type button": when this
 * returns ≤ 1 leaf the type is forced, so the picker button is redundant. */
export function collectTypeLeaves(items: TypeMenuNode[]): TypeMenuNode[] {
  const out: TypeMenuNode[] = []
  for (const it of items) {
    if (it.isSeparator || it.id === 'remove') continue
    if (it.items) out.push(...collectTypeLeaves(it.items))
    else if (it.onClick) out.push(it)
  }
  return out
}
