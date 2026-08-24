/**
 * The Design tab's section registry — single source of truth for the
 * icon rail, the sidebar group entries, and the section-focus routing.
 * Order here IS display order (rail top-to-bottom, sidebar rows).
 */

import type { DesignSectionKey } from '../types/editor'
import type { ApiDesign } from '../types/apiDesign'
import type { Icon } from 'electron-core-ui/types'

export interface DesignSectionSpec {
  key: DesignSectionKey
  /** The section icon for the rail + the sidebar row. A full `Icon` (not
   * just a codicon name) so a section can draw a library glyph — Routes
   * uses the Phosphor road, Models the type-hierarchy boxes. */
  icon: Icon
  /** i18n key of the section label (`design.section.<key>`). */
  labelKey: string
  /** Number badge shown on the sidebar row, when the section lists
   * countable entries. `null` = no count. */
  count: (design: ApiDesign) => number | null
}

export const DESIGN_SECTIONS: readonly DesignSectionSpec[] = [
  { key: 'settings', icon: { type: 'codicon', value: 'settings-gear' }, labelKey: 'design.section.settings', count: () => null },
  { key: 'models', icon: { type: 'codicon', value: 'type-hierarchy-sub' }, labelKey: 'design.section.models', count: (d) => d.models.length },
  { key: 'enums', icon: { type: 'codicon', value: 'symbol-enum' }, labelKey: 'design.section.enums', count: (d) => d.enums.length },
  { key: 'routes', icon: { type: 'phosphor', value: 'RoadHorizon' }, labelKey: 'design.section.routes', count: (d) => d.routeGroups.reduce((n, g) => n + g.routes.length, 0) },
  { key: 'server', icon: { type: 'codicon', value: 'server-process' }, labelKey: 'design.section.server', count: () => null },
  { key: 'documentation', icon: { type: 'codicon', value: 'book' }, labelKey: 'design.section.documentation', count: () => null },
  { key: 'notes', icon: { type: 'codicon', value: 'note' }, labelKey: 'design.section.notes', count: () => null },
  { key: 'code', icon: { type: 'codicon', value: 'code' }, labelKey: 'design.section.code', count: () => null }
]

/** The design's own codicon, everywhere it appears (sidebar, tab,
 * search, badges). */
export const DESIGN_CODICON = 'symbol-color'

const SECTION_ROW_PREFIX = 'design-section:'

/** Sidebar row id of a design's virtual section entry. Not a tree-item
 * id: these rows exist only in the sidebar view model. */
export function designSectionRowId(designId: string, section: DesignSectionKey): string {
  return `${SECTION_ROW_PREFIX}${designId}:${section}`
}

/** Parse a sidebar row id back into `{ designId, section }`, or `null`
 * for anything that is not a design section row. */
export function parseDesignSectionRowId(rowId: string): { designId: string; section: DesignSectionKey } | null {
  if (!rowId.startsWith(SECTION_ROW_PREFIX)) return null
  const rest = rowId.slice(SECTION_ROW_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return null
  const designId = rest.slice(0, sep)
  const section = rest.slice(sep + 1)
  if (!DESIGN_SECTIONS.some((s) => s.key === section)) return null
  return { designId, section: section as DesignSectionKey }
}
