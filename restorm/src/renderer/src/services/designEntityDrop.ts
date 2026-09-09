/**
 * Drag & drop for a design's Models / Enums / Routes sidebar nodes — confined to
 * the SAME design + section (a model/enum/route can never be dragged out of its
 * design; that boundary is enforced in `useItemOperations.canDropSelection`).
 *
 * Routes reuse the pure, unit-tested `routesDrop` module; models reorder +
 * reparent by `inheritsFrom` (cycle-safe, mirroring the old in-listing rule);
 * enums are a flat reorder. Every write goes through `assignDesignSection` (the
 * one reactive-mutation door).
 */

import type { ApiDesign, DesignModel } from '../../../shared/types/collections'
import type { DesignEntitySection } from '../../../shared/design/designSections'
import { canRoutesDrop, applyRoutesDrop, type RoutesDropPosition } from '../../../shared/design/routesDrop'
import { assignDesignSection } from '../components/Design/designMutations'

type Pos = RoutesDropPosition // 'before' | 'after' | 'into'

// ── Models: reorder + reparent by inheritance ───────────────────────────────
function modelSubtree(models: readonly DesignModel[], rootId: string): Set<string> {
  const childMap = new Map<string, string[]>()
  for (const m of models) {
    const p = m.design?.inheritsFrom
    if (p !== undefined) { const a = childMap.get(p) ?? []; a.push(m.id); childMap.set(p, a) }
  }
  const out = new Set<string>([rootId])
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) break
    for (const c of childMap.get(id) ?? []) if (!out.has(c)) { out.add(c); stack.push(c) }
  }
  return out
}

function canDropModel(models: readonly DesignModel[], draggedId: string, targetId: string, position: Pos): boolean {
  if (draggedId === targetId) return false
  const target = models.find((m) => m.id === targetId)
  if (target === undefined) return false
  const newParent = position === 'into' ? targetId : target.design?.inheritsFrom
  if (newParent === undefined) return true
  return !modelSubtree(models, draggedId).has(newParent)
}

function moveModel(design: ApiDesign, draggedId: string, targetId: string, position: Pos): void {
  if (!canDropModel(design.models, draggedId, targetId, position)) return
  const dragged = design.models.find((m) => m.id === draggedId)
  const target = design.models.find((m) => m.id === targetId)
  if (dragged === undefined || target === undefined) return
  const newParent = position === 'into' ? targetId : target.design?.inheritsFrom
  const nextDesign = { ...(dragged.design ?? {}) }
  if (newParent === undefined) delete nextDesign.inheritsFrom
  else nextDesign.inheritsFrom = newParent
  const updated: DesignModel = Object.keys(nextDesign).length > 0
    ? { ...dragged, design: nextDesign }
    : (() => { const { design: _dropped, ...rest } = dragged; return rest as DesignModel })()
  const without = design.models.filter((m) => m.id !== draggedId)
  const targetIdx = without.findIndex((m) => m.id === targetId)
  const insertIdx = position === 'before' ? targetIdx : targetIdx + 1
  without.splice(insertIdx, 0, updated)
  assignDesignSection(design, 'models', without)
}

// ── Enums: flat reorder ─────────────────────────────────────────────────────
function moveEnum(design: ApiDesign, draggedId: string, targetId: string, position: Pos): void {
  if (draggedId === targetId) return
  const enums = [...design.enums]
  const from = enums.findIndex((e) => e.id === draggedId)
  if (from < 0) return
  const moved = enums.splice(from, 1)[0]
  if (moved === undefined) return
  const targetIdx = enums.findIndex((e) => e.id === targetId)
  if (targetIdx < 0) { enums.splice(from, 0, moved); return }
  enums.splice(position === 'before' ? targetIdx : targetIdx + 1, 0, moved)
  assignDesignSection(design, 'enums', enums)
}

/** Whether `sourceId` may be dropped `position` `targetId` within `section`. */
export function canDropDesignEntity(
  design: ApiDesign,
  section: DesignEntitySection,
  sourceId: string,
  targetId: string,
  position: Pos
): boolean {
  if (sourceId === targetId) return false
  if (section === 'routes') return canRoutesDrop(design.routeGroups, { sourceId, targetId, position })
  if (section === 'models') return canDropModel(design.models, sourceId, targetId, position)
  return true // enums: any reorder is valid
}

/** Apply the drop (already validated by {@link canDropDesignEntity}). */
export function applyDesignEntityDrop(
  design: ApiDesign,
  section: DesignEntitySection,
  sourceId: string,
  targetId: string,
  position: Pos
): void {
  if (section === 'routes') {
    const next = applyRoutesDrop(design.routeGroups, { sourceId, targetId, position })
    if (next !== null) assignDesignSection(design, 'routeGroups', next)
    return
  }
  if (section === 'models') { moveModel(design, sourceId, targetId, position); return }
  moveEnum(design, sourceId, targetId, position)
}
