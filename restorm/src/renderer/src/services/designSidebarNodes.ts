/**
 * Sidebar nodes for a design's Models / Enums / Routes sections.
 *
 * These replace the old per-section left-hand listings: the model tree
 * (inheritance nesting), the flat enum list, and the route tree (groups → their
 * routes, then sub-groups) are hung directly under the design's section rows in
 * the sidebar. Each node's id is a `designEntityRowId`, so a click routes to the
 * design tab focused on that entity, and its drag is confined to its own section
 * by `useItemOperations` — a model/enum/route can never be dragged out of its
 * design.
 *
 * Each node carries its own `contextMenuItems`; `attachContextMenus` preserves
 * them (it only overwrites when the central builder returns a menu, which it
 * doesn't for these virtual ids). The menu handlers fire through
 * `options.onDesignEntityAction`, which navigates to the design tab and hands the
 * SECTION component the action to run — so the add/clone/CRUD/delete logic (and
 * the delete-impact + CRUD modals) stay single-sourced in the sections. Rename
 * uses the ListView inline-rename (`id: 'rename-item'`), committed through the
 * sidebar's `onItemRename`.
 */

import React, { type ReactNode } from 'react'
import { i18n } from 'electron-core-ui/renderer'
import type { ListViewItemData, ContextMenuItem } from 'electron-core-ui/renderer'
import type { ApiDesign, DesignModel, DesignRouteGroup } from '../../../shared/types/collections'
import { designEntityRowId, type DesignEntitySection } from '../../../shared/design/designSections'
import type { DesignEntityAction } from './designSectionIntent'
import { validateApiDesignCached } from '../../../shared/design/validateApiDesign'
import { httpBadgeIdFor } from '../../../shared/utils/httpMethod'
import { RegistryBadge } from '../components/common/RegistryBadge'

/** Fired from a node's context menu: run `action` on `entityId` in this section. */
export type DesignEntityActionHandler = (
  designId: string,
  section: DesignEntitySection,
  action: DesignEntityAction,
  entityId?: string
) => void

export interface SidebarNodeOptions {
  expandedIds: Set<string>
  onDesignEntityAction?: DesignEntityActionHandler
  /** Richer rows for the section-root LISTING view (not the narrow sidebar):
   * an enum shows its values, a route shows its description. */
  detailed?: boolean
}

/** A dimmed, comma-separated trailing detail for the listing rows. */
function listingDetail(text: string, className: string): ReactNode {
  return React.createElement('span', { className }, text)
}

const unnamed = (): string => i18n.t('design.schema.unnamed', '(unnamed)')
const t = (key: string, fallback: string): string => i18n.t(key, fallback)
const sep = (id: string): ContextMenuItem => ({ id, label: '', isSeparator: true })
/** The inline-rename trigger the ListView recognises by id. Built lazily (not a
 * module-level const) so the label resolves at render time, not import time. */
const renameEntry = (): ContextMenuItem => ({ id: 'rename-item', label: i18n.t('sidebar.contextMenu.rename'), icon: 'edit' })

function errorDot(testId: string): ReactNode {
  return React.createElement('span', {
    className: 'design-list-error-dot codicon codicon-error',
    'data-testid': testId
  })
}

/** Models nested by `inheritsFrom` (a child sits under the model it extends). */
function modelNodes(
  design: ApiDesign,
  options: SidebarNodeOptions,
  hasIssue: (id: string) => boolean
): ListViewItemData[] {
  const fire = options.onDesignEntityAction
  const childMap = new Map<string, DesignModel[]>()
  const ids = new Set(design.models.map((m) => m.id))
  const roots: DesignModel[] = []
  for (const m of design.models) {
    const parent = m.design?.inheritsFrom
    if (parent !== undefined && ids.has(parent)) {
      const arr = childMap.get(parent) ?? []
      arr.push(m)
      childMap.set(parent, arr)
    } else roots.push(m)
  }
  const build = (m: DesignModel, visited: Set<string>): ListViewItemData => {
    const rowId = designEntityRowId(design.id, 'models', m.id)
    const kids = visited.has(m.id)
      ? []
      : (childMap.get(m.id) ?? []).map((c) => build(c, new Set(visited).add(m.id)))
    const menu: ContextMenuItem[] = [
      renameEntry(),
      { id: 'add-sub-model', label: t('design.models.addSubModel', 'Add a sub-model'), icon: 'add', onClick: () => fire?.(design.id, 'models', 'addSubModel', m.id) },
      { id: 'generate-crud', label: t('design.modelSettings.generateCrud', 'Generate the CRUD'), icon: 'type-hierarchy-sub', onClick: () => fire?.(design.id, 'models', 'generateCrud', m.id) },
      sep('sep-del'),
      { id: 'delete-entity', label: t('design.models.delete', 'Delete the model'), icon: 'trash', onClick: () => fire?.(design.id, 'models', 'delete', m.id) }
    ]
    return {
      id: rowId,
      title: m.doc.name === '' ? unnamed() : m.doc.name,
      icon: 'symbol-class',
      draggable: true,
      contextMenuItems: menu,
      ...(kids.length > 0
        ? { isExpandable: true, isExpanded: options.expandedIds.has(rowId), children: kids }
        : {}),
      ...(hasIssue(m.id) ? { rightActions: errorDot(`design-model-node-error-${m.id}`) } : {})
    }
  }
  return roots.map((m) => build(m, new Set()))
}

/** Enums — a flat list under the Enums section row. */
function enumNodes(
  design: ApiDesign,
  options: SidebarNodeOptions,
  hasIssue: (id: string) => boolean
): ListViewItemData[] {
  const fire = options.onDesignEntityAction
  return design.enums.map((e) => {
    const values = (e.doc.enumValues ?? [])
      .map((v, i) => (e.memberNames?.[i] !== undefined && e.memberNames[i] !== '' ? e.memberNames[i] : String(v)))
      .join(', ')
    const issue = hasIssue(e.id) ? errorDot(`design-enum-node-error-${e.id}`) : null
    const nameNode = e.doc.name === '' ? unnamed() : e.doc.name
    // Detailed (listing) rows show the name in the same weight for EVERY enum
    // (with or without values), a touch larger, then its values trailing it in a
    // muted normal weight — not pushed to the far-right edge.
    const title = options.detailed === true
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement('span', { className: 'design-listing-enum-name' }, nameNode),
          values !== '' ? listingDetail(values, 'design-listing-values') : null
        )
      : nameNode
    return {
      id: designEntityRowId(design.id, 'enums', e.id),
      title,
      icon: 'symbol-enum',
      draggable: true,
      contextMenuItems: [
        renameEntry(),
        sep('sep-del'),
        { id: 'delete-entity', label: t('sidebar.contextMenu.delete', 'Delete'), icon: 'trash', onClick: () => fire?.(design.id, 'enums', 'delete', e.id) }
      ] as ContextMenuItem[],
      ...(issue !== null ? { rightActions: issue } : {})
    }
  })
}

/** Route groups (nesting sub-groups), each holding its routes then its sub-groups. */
function routeNodes(
  design: ApiDesign,
  options: SidebarNodeOptions,
  hasIssue: (id: string) => boolean
): ListViewItemData[] {
  const fire = options.onDesignEntityAction
  const childGroupsOf = (parentId: string | undefined): DesignRouteGroup[] =>
    design.routeGroups.filter((g) => g.parentId === parentId)

  const routeNode = (route: DesignRouteGroup['routes'][number]): ListViewItemData => {
    const method = route.doc.match.method ?? 'GET'
    const title = route.doc.summary !== undefined && route.doc.summary !== ''
      ? route.doc.summary
      : route.doc.match.urlPattern
    const badge = React.createElement(RegistryBadge, { badgeId: httpBadgeIdFor(method), text: method })
    const deprecated = route.doc.deprecated === true
    const dim = (node: ReactNode): ReactNode =>
      React.createElement('span', { style: { opacity: 0.5 }, title: i18n.t('design.flags.deprecated', 'deprecated') }, node)
    const description = route.doc.description
    const issue = hasIssue(route.id) ? errorDot(`design-route-node-error-${route.id}`) : null
    const routeRight = options.detailed === true && description !== undefined && description !== ''
      ? React.createElement(React.Fragment, null, issue, listingDetail(description, 'design-listing-route-desc'))
      : issue
    return {
      id: designEntityRowId(design.id, 'routes', route.id),
      title: deprecated ? dim(title) : title,
      icon: deprecated ? dim(badge) : badge,
      draggable: true,
      contextMenuItems: [
        { id: 'clone-entity', label: t('sidebar.contextMenu.clone', 'Clone'), icon: 'copy', onClick: () => fire?.(design.id, 'routes', 'clone', route.id) },
        renameEntry(),
        sep('sep-del'),
        { id: 'delete-entity', label: t('sidebar.contextMenu.delete', 'Delete'), icon: 'trash', onClick: () => fire?.(design.id, 'routes', 'delete', route.id) }
      ] as ContextMenuItem[],
      ...(routeRight !== null ? { rightActions: routeRight } : {})
    }
  }

  const buildGroup = (group: DesignRouteGroup): ListViewItemData => {
    const rowId = designEntityRowId(design.id, 'routes', group.id)
    return {
      id: rowId,
      title: group.doc.name === '' ? unnamed() : group.doc.name,
      icon: React.createElement('span', { className: 'codicon codicon-folder', 'aria-hidden': true }),
      isExpandable: true,
      isExpanded: options.expandedIds.has(rowId),
      draggable: true,
      contextMenuItems: [
        { id: 'add-route', label: t('design.routes.addRoute', 'Add a route'), icon: 'add', onClick: () => fire?.(design.id, 'routes', 'addRoute', group.id) },
        { id: 'add-subgroup', label: t('design.routes.addSubgroup', 'Add a sub-group'), icon: 'new-folder', onClick: () => fire?.(design.id, 'routes', 'addSubgroup', group.id) },
        renameEntry(),
        sep('sep-del'),
        { id: 'delete-entity', label: t('sidebar.contextMenu.delete', 'Delete'), icon: 'trash', onClick: () => fire?.(design.id, 'routes', 'delete', group.id) }
      ] as ContextMenuItem[],
      ...(hasIssue(group.id) ? { rightActions: errorDot(`design-group-node-error-${group.id}`) } : {}),
      children: [
        ...group.routes.map((route) => routeNode(route)),
        ...childGroupsOf(group.id).map((g) => buildGroup(g))
      ]
    }
  }

  return childGroupsOf(undefined).map((g) => buildGroup(g))
}

/** The child nodes hung under a design's Models / Enums / Routes section row. */
export function designSectionChildren(
  design: ApiDesign,
  section: DesignEntitySection,
  options: SidebarNodeOptions
): ListViewItemData[] {
  const issues = validateApiDesignCached(design)
  const hasIssue = (id: string): boolean => issues.some((issue) => issue.path.includes(id))
  if (section === 'models') return modelNodes(design, options, hasIssue)
  if (section === 'enums') return enumNodes(design, options, hasIssue)
  return routeNodes(design, options, hasIssue)
}

/** The context menu for a design's Models / Enums / Routes SECTION row itself —
 * the "add" entry point when the section is empty or you want a top-level add. */
export function designSectionRowMenu(
  designId: string,
  section: DesignEntitySection,
  onAction?: DesignEntityActionHandler
): ContextMenuItem[] {
  if (onAction === undefined) return []
  if (section === 'models') {
    return [{ id: 'add-model', label: t('design.models.add', 'Add a model'), icon: 'add', onClick: () => { onAction(designId, 'models', 'add'); } }]
  }
  if (section === 'enums') {
    return [{ id: 'add-enum', label: t('design.enums.addEnum', 'Add an enum'), icon: 'add', onClick: () => { onAction(designId, 'enums', 'add'); } }]
  }
  return [
    { id: 'add-route', label: t('design.routes.addRoute', 'Add a route'), icon: 'add', onClick: () => { onAction(designId, 'routes', 'add'); } },
    { id: 'add-group', label: t('design.routes.addGroup', 'Add a group'), icon: 'new-folder', onClick: () => { onAction(designId, 'routes', 'addGroup'); } }
  ]
}
