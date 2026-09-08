/**
 * Cross-component channel for "open the design tab AND focus section
 * X (and optionally entity Y in it)" navigation. The opener (a sidebar
 * group row under a design node, a "Used by" chip) stages the target
 * here, then triggers the normal design-tab open path; the matching
 * `DesignTabView` consumes the staged value once it mounts (or
 * immediately, when it is already mounted — the single-tab policy means
 * clicking a group row usually refocuses an open tab with no remount).
 *
 * Same rationale as `envFolderTabIntent.ts`: the view may not be
 * mounted when the opener fires, so a fire-and-forget event would be
 * lost — a module-level Map keyed by design id lets the view drain the
 * intent atomically on first render, and the subscriber path covers
 * the already-mounted case.
 */

import type { DesignSectionKey } from '../../../shared/types/editor'
import type { DesignEntitySection } from '../../../shared/design/designSections'

/** An action a sidebar node's context menu asks the (mounted) section to run,
 * reusing the section's own handler + any modal it opens (delete-impact, CRUD). */
export type DesignEntityAction =
  | 'add'          // add a model / enum / route to the section (routes: into a default group)
  | 'addGroup'     // routes: add a route group at the top level
  | 'addSubModel'  // add a child model inheriting from entityId
  | 'addRoute'     // add a route to the group entityId
  | 'addSubgroup'  // add a sub-group under the group entityId
  | 'clone'        // clone the route entityId
  | 'generateCrud' // open the CRUD generator for the model entityId
  | 'delete'       // delete entityId (via the section's confirm/impact flow)

/** A pending action handed to a section component via its `pendingAction` prop.
 * `nonce` makes it fire exactly once, even across a remount. */
export interface PendingEntityAction {
  action: DesignEntityAction
  entityId?: string
  nonce: number
}

export interface DesignSectionIntent {
  section: DesignSectionKey
  /** Entity to select inside the section (model id, route id…). */
  entityId?: string
  /** An action for the section to run on arrival (add / clone / delete / CRUD…),
   * fired from a sidebar node's context menu. Absent for a plain focus/navigate. */
  action?: DesignEntityAction
}

const pendingByDesignId = new Map<string, DesignSectionIntent>()
type Subscriber = (designId: string, intent: DesignSectionIntent) => void
const subscribers = new Set<Subscriber>()

/** Stage a section (and optional entity) for the next render of the
 *  design with `designId`. Call just BEFORE triggering the normal open
 *  flow (`handleItemClick(designId)`); `DesignTabView` drains the entry
 *  via `consumePendingDesignSection`. */
export function setPendingDesignSection(
  designId: string,
  section: DesignSectionKey,
  entityId?: string,
  action?: DesignEntityAction
): void {
  if (!designId) return
  const intent: DesignSectionIntent = { section }
  if (entityId !== undefined) intent.entityId = entityId
  if (action !== undefined) intent.action = action
  pendingByDesignId.set(designId, intent)
  for (const sub of subscribers) sub(designId, intent)
}

/** Read + clear the staged intent for a design. `undefined` when
 *  nothing is pending. */
export function consumePendingDesignSection(designId: string): DesignSectionIntent | undefined {
  const value = pendingByDesignId.get(designId)
  if (value !== undefined) pendingByDesignId.delete(designId)
  return value
}

/** Read WITHOUT clearing — for React state initializers, which
 *  StrictMode double-invokes in dev builds: a consuming initializer
 *  would drain the map on the throwaway first call and hand the real
 *  one nothing. The mount effect does the consuming. */
export function peekPendingDesignSection(designId: string): DesignSectionIntent | undefined {
  return pendingByDesignId.get(designId)
}

/** Subscribe to live intent updates — covers the already-mounted tab. */
export function subscribeDesignSectionIntent(handler: Subscriber): () => void {
  subscribers.add(handler)
  return () => { subscribers.delete(handler) }
}

// ── Active section (where a mounted design tab IS right now) ──────────────
// Distinct from the one-shot pending intent above: this is the durable "the
// tab is currently showing section X", published by `DesignTabView` whenever
// its active section changes. It lets the sidebar highlight the matching
// section row no matter how the tab was focused — a row click, a tab switch
// (`handleTabActivate` reads it), or back/forward.
const activeByDesignId = new Map<string, DesignSectionKey>()
type ActiveSubscriber = (designId: string, section: DesignSectionKey) => void
const activeSubscribers = new Set<ActiveSubscriber>()

/** Record the section a design tab is currently showing, notifying
 *  subscribers (e.g. the tab breadcrumb) when it actually changes. */
export function setActiveDesignSection(designId: string, section: DesignSectionKey): void {
  if (!designId) return
  if (activeByDesignId.get(designId) === section) return
  activeByDesignId.set(designId, section)
  for (const sub of activeSubscribers) sub(designId, section)
}

/** The section a design tab is currently showing, or `undefined` when the
 *  design has no live tab. */
export function getActiveDesignSection(designId: string): DesignSectionKey | undefined {
  return activeByDesignId.get(designId)
}

/** Subscribe to active-section changes — the breadcrumb reads this to keep
 *  its trailing section segment live. */
export function subscribeActiveDesignSection(handler: ActiveSubscriber): () => void {
  activeSubscribers.add(handler)
  return () => { activeSubscribers.delete(handler) }
}

// ── Active ENTITY (the selected model / enum / route in the design tab) ──
// Drives the breadcrumb's trailing entity segment: `null` = the section listing
// (no entity selected), otherwise the selected entity's section + id + label.
export interface ActiveDesignEntity {
  section: DesignEntitySection
  entityId: string
  label: string
  /** Sidebar row ids to expand so this entity is revealed in the tree — the
   * design node, its section row, and any parent model / route-group rows.
   * Consumed by the navigation hook when "sync sidebar with tabs" is on. */
  ancestorRowIds: string[]
}
const activeEntityByDesignId = new Map<string, ActiveDesignEntity>()
type ActiveEntitySubscriber = (designId: string) => void
const activeEntitySubscribers = new Set<ActiveEntitySubscriber>()

export function setActiveDesignEntity(designId: string, entity: ActiveDesignEntity | null): void {
  if (!designId) return
  const cur = activeEntityByDesignId.get(designId) ?? null
  if (cur === entity) return
  if (cur !== null && entity !== null && cur.section === entity.section && cur.entityId === entity.entityId && cur.label === entity.label) return
  if (entity === null) activeEntityByDesignId.delete(designId)
  else activeEntityByDesignId.set(designId, entity)
  for (const sub of activeEntitySubscribers) sub(designId)
}
export function getActiveDesignEntity(designId: string): ActiveDesignEntity | undefined {
  return activeEntityByDesignId.get(designId)
}
export function subscribeActiveDesignEntity(handler: ActiveEntitySubscriber): () => void {
  activeEntitySubscribers.add(handler)
  return () => { activeEntitySubscribers.delete(handler) }
}
