import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setPendingDesignSection, type PendingEntityAction } from '../../services/designSectionIntent'
import { DesignEntityListing } from './DesignEntityListing'
import {
  Button,
  EditableLabel,
  InputBox,
  MarkdownEditor,
  Modal,
  SelectBox,
  Table,
  Tabs,
  type ISelectData,
  type TableColumn
} from 'electron-core-ui/renderer'
import type {
  ApiDesign,
  DesignAuthKind,
  DesignRoute,
  DesignRouteGroup
} from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { generateUniqueId } from '../../utils/treeManipulation'
import { DesignIssuesCallout } from './DesignIssuesCallout'
import { assignDesignSection, replaceGroup, replaceRoute } from './designMutations'
import { RouteDefinitionTab } from './RouteDefinitionTab'
import { RouteResponsesTab } from './RouteResponsesTab'
import { RouteSettingsTab } from './RouteSettingsTab'
import { DesignRouteCodegenTab } from './DesignRouteCodegenTab'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { DesignTagsEditor } from './DesignTagsEditor'

const AUTH_KINDS: readonly DesignAuthKind[] = ['none', 'bearer', 'apiKeyHeader', 'basic']

export interface DesignRoutesSectionProps {
  design: ApiDesign
  issues?: readonly DesignIssue[]
  selectedEntityId: string | null
  onSelectEntity: (entityId: string | null) => void
  /** A one-shot action fired from a sidebar route/group node's context menu. */
  pendingAction?: PendingEntityAction | null
}

interface Selection {
  group: DesignRouteGroup
  route: DesignRoute | null
}

/**
 * The Routes section: a two-level tree on the left (group → routes,
 * method badges like requests), the selected GROUP's contract card or
 * the selected ROUTE's request-editor-style card (Définition /
 * Réponses / Réglages / Notes tabs) on the right.
 */
export const DesignRoutesSection: React.FC<DesignRoutesSectionProps> = ({ design, issues = [], selectedEntityId, onSelectEntity, pendingAction }) => {
  const { t } = useTranslation()
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<DesignRouteGroup | null>(null)

  // Plain per-render resolution (cheap linear scan) — memoizing it made
  // the React compiler bail out of the whole component.
  const resolveSelection = (): Selection | null => {
    if (selectedEntityId === null) return null
    for (const group of design.routeGroups) {
      if (group.id === selectedEntityId) return { group, route: null }
      const route = group.routes.find((r) => r.id === selectedEntityId)
      if (route !== undefined) return { group, route }
    }
    return null
  }
  const selection = resolveSelection()

  const createGroup = useCallback((parentId?: string) => {
    const taken = new Set(design.routeGroups.map((g) => g.doc.name))
    let name = t('design.routes.newGroupName', 'NewGroup')
    for (let i = 2; taken.has(name); i++) name = `${t('design.routes.newGroupName', 'NewGroup')}${i}`
    const fresh: DesignRouteGroup = {
      id: generateUniqueId(),
      doc: { name },
      design: { basePath: `/${name.toLowerCase()}` },
      routes: [],
      ...(parentId !== undefined ? { parentId } : {})
    }
    assignDesignSection(design, 'routeGroups', [...design.routeGroups, fresh])
    onSelectEntity(fresh.id)
  }, [design, onSelectEntity, t])

  const addRoute = useCallback((group: DesignRouteGroup) => {
    // A route created from scratch needs a name up front: its display name is
    // `doc.summary`, and the rename control is unreachable while it's empty.
    // De-dupe across every route in the design, mirroring `createGroup`.
    const taken = new Set(
      design.routeGroups.flatMap((g) => g.routes.map((r) => r.doc.summary).filter((s): s is string => Boolean(s)))
    )
    let summary = t('design.routes.newRouteName', 'NewRoute')
    for (let i = 2; taken.has(summary); i++) summary = `${t('design.routes.newRouteName', 'NewRoute')}${i}`
    const fresh: DesignRoute = {
      id: generateUniqueId(),
      doc: {
        summary,
        match: { urlPattern: '/', method: 'GET' },
        responses: { '200': { description: 'OK' } }
      }
    }
    replaceGroup(design, group.id, { ...group, routes: [...group.routes, fresh] })
    onSelectEntity(fresh.id)
  }, [design, onSelectEntity, t])

  const deleteRoute = useCallback((group: DesignRouteGroup, routeId: string) => {
    replaceGroup(design, group.id, { ...group, routes: group.routes.filter((r) => r.id !== routeId) })
    if (selectedEntityId === routeId) onSelectEntity(group.id)
  }, [design, onSelectEntity, selectedEntityId])

  const cloneRoute = useCallback((groupId: string, routeId: string) => {
    const group = design.routeGroups.find((g) => g.id === groupId)
    const src = group?.routes.find((r) => r.id === routeId)
    if (group === undefined || src === undefined) return
    // A deep, proxy-free copy (the design is a reactive proxy) with a fresh id
    // and a name de-duped across every route, like a new route.
    const copy = JSON.parse(JSON.stringify(src)) as DesignRoute
    copy.id = generateUniqueId()
    const taken = new Set(design.routeGroups.flatMap((g) => g.routes.map((r) => r.doc.summary).filter((s): s is string => Boolean(s))))
    const base = src.doc.summary !== undefined && src.doc.summary !== '' ? src.doc.summary : src.doc.match.urlPattern
    let name = base
    for (let i = 2; taken.has(name); i++) name = `${base}${i}`
    copy.doc = { ...copy.doc, summary: name }
    const idx = group.routes.findIndex((r) => r.id === routeId)
    const routes = [...group.routes]
    routes.splice(idx + 1, 0, copy)
    replaceGroup(design, group.id, { ...group, routes })
    onSelectEntity(copy.id)
  }, [design, onSelectEntity])

  // Run a one-shot action from a sidebar route/group node's context menu, once
  // per nonce: add(-group/route/subgroup) / clone / delete — delegating to the
  // section's own handlers (group delete keeps its impact-confirm modal).
  const lastRouteActionNonce = useRef(0)
  useEffect(() => {
    if (!pendingAction || pendingAction.nonce === lastRouteActionNonce.current) return
    lastRouteActionNonce.current = pendingAction.nonce
    const { action, entityId } = pendingAction
    // Run the one-shot on a microtask so the state changes (add / clone / open a
    // confirm modal) don't fire synchronously inside the effect that observed it.
    queueMicrotask(() => {
      if (action === 'addGroup') { createGroup(); return }
      if (action === 'add') {
        const first = design.routeGroups.find((g) => g.parentId === undefined) ?? design.routeGroups[0]
        if (first !== undefined) { addRoute(first); return }
        // No group yet: bootstrap one WITH a first route (named up front, since a
        // route's display name is its summary and rename is unreachable while empty).
        const groupName = t('design.routes.newGroupName', 'NewGroup')
        const route: DesignRoute = {
          id: generateUniqueId(),
          doc: { summary: t('design.routes.newRouteName', 'NewRoute'), match: { urlPattern: '/', method: 'GET' }, responses: { '200': { description: 'OK' } } }
        }
        const group: DesignRouteGroup = {
          id: generateUniqueId(),
          doc: { name: groupName },
          design: { basePath: `/${groupName.toLowerCase()}` },
          routes: [route]
        }
        assignDesignSection(design, 'routeGroups', [...design.routeGroups, group])
        onSelectEntity(route.id)
        return
      }
      if (entityId === undefined) return
      const group = design.routeGroups.find((g) => g.id === entityId)
      if (group !== undefined) {
        if (action === 'addRoute') addRoute(group)
        else if (action === 'addSubgroup') createGroup(group.id)
        else if (action === 'delete') setPendingDeleteGroup(group)
        return
      }
      const owner = design.routeGroups.find((g) => g.routes.some((r) => r.id === entityId))
      if (owner === undefined) return
      if (action === 'clone') cloneRoute(owner.id, entityId)
      else if (action === 'delete') deleteRoute(owner, entityId)
    })
  }, [pendingAction, design, createGroup, addRoute, cloneRoute, deleteRoute, onSelectEntity, t])

  const confirmDeleteGroup = useCallback(() => {
    if (pendingDeleteGroup === null) return
    // Deleting a group takes its whole subtree with it (its descendant
    // sub-groups would otherwise be orphaned by their dangling parentId).
    const doomed = new Set<string>([pendingDeleteGroup.id])
    let grew = true
    while (grew) {
      grew = false
      for (const g of design.routeGroups) {
        if (g.parentId !== undefined && doomed.has(g.parentId) && !doomed.has(g.id)) { doomed.add(g.id); grew = true }
      }
    }
    assignDesignSection(design, 'routeGroups', design.routeGroups.filter((g) => !doomed.has(g.id)))
    if (selection !== null && doomed.has(selection.group.id)) onSelectEntity(null)
    setPendingDeleteGroup(null)
  }, [design, onSelectEntity, pendingDeleteGroup, selection])

  const selectedGroup = selection?.group ?? null
  const selectedRoute = selection?.route ?? null

  return (
    <div className="design-section design-entity-detail-section" data-testid="design-routes-section">
      {selection === null ? (
        <DesignEntityListing
          design={design}
          section="routes"
          onSelect={onSelectEntity}
          onAction={(designId, section, action, entityId) => {
            // Delete is handled directly (open the group confirm, or drop the
            // route) so it doesn't first navigate INTO the entity — like the
            // models section. Other actions still route through the intent bus.
            if (action === 'delete' && entityId !== undefined) {
              const group = design.routeGroups.find((g) => g.id === entityId)
              if (group !== undefined) { setPendingDeleteGroup(group); return }
              const owner = design.routeGroups.find((g) => g.routes.some((r) => r.id === entityId))
              if (owner !== undefined) deleteRoute(owner, entityId)
              return
            }
            setPendingDesignSection(designId, section, entityId, action)
          }}
        />
      ) : (
        <div className="design-entity-detail design-model-card" data-testid="design-routes-detail">
        {selectedGroup !== null && selectedRoute === null && (
          <GroupCard
            key={selectedGroup.id}
            design={design}
            issues={issues}
            group={selectedGroup}
            onAddRoute={() => { addRoute(selectedGroup) }}
            onDelete={() => { setPendingDeleteGroup(selectedGroup) }}
          />
        )}
        {selectedGroup !== null && selectedRoute !== null && (
          <RouteCard
            key={selectedRoute.id}
            design={design}
            issues={issues}
            group={selectedGroup}
            route={selectedRoute}
            onOpenGroup={(groupId) => { onSelectEntity(groupId) }}
          />
        )}
        </div>
      )}

      {pendingDeleteGroup !== null && (
        <Modal
          title={t('design.routes.deleteGroupTitle', 'Delete {{name}}?', { name: pendingDeleteGroup.doc.name })}
          isOpen
          onClose={() => { setPendingDeleteGroup(null) }}
          size="dialog"
          data-testid="design-group-delete-modal"
          enterActionTestId="design-group-delete-confirm"
        >
          <div className="design-delete-modal-body">
            <p>{t('design.routes.deleteGroupImpact', 'The group and its {{count}} routes will be deleted.', { count: pendingDeleteGroup.routes.length })}</p>
            <div className="design-delete-modal-actions">
              <Button secondary onClick={() => { setPendingDeleteGroup(null) }} data-testid="design-group-delete-cancel">
                {t('sidebar.deleteConfirm.cancel')}
              </Button>
              <Button onClick={confirmDeleteGroup} data-testid="design-group-delete-confirm">
                {t('sidebar.deleteConfirm.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Group card ────────────────────────────────────────────────────────

const GroupCard: React.FC<{
  design: ApiDesign
  issues: readonly DesignIssue[]
  group: DesignRouteGroup
  onAddRoute: () => void
  onDelete: () => void
}> = ({ design, issues, group, onAddRoute, onDelete }) => {
  const { t } = useTranslation()

  const patchDesignMeta = useCallback((patch: { basePath?: string | undefined; versionPrefix?: string | undefined; auth?: DesignAuthKind | undefined }) => {
    const merged = { ...(group.design ?? {}), ...patch }
    const cleaned: NonNullable<DesignRouteGroup['design']> = {}
    if (merged.basePath !== undefined && merged.basePath !== '') cleaned.basePath = merged.basePath
    if (merged.versionPrefix !== undefined && merged.versionPrefix !== '') cleaned.versionPrefix = merged.versionPrefix
    if (merged.auth !== undefined) cleaned.auth = merged.auth
    if (merged.headers !== undefined && merged.headers.length > 0) cleaned.headers = merged.headers
    replaceGroup(design, group.id, Object.keys(cleaned).length > 0 ? { ...group, design: cleaned } : { id: group.id, doc: group.doc, routes: group.routes })
  }, [design, group])

  const setHeaders = useCallback((headers: { name: string; example?: string; description?: string }[]) => {
    const current = group.design ?? {}
    const { headers: _dropped, ...rest } = current
    replaceGroup(design, group.id, {
      ...group,
      design: headers.length > 0 ? { ...rest, headers } : rest
    })
  }, [design, group])

  const headers = group.design?.headers ?? []

  const headerColumns: TableColumn<{ name: string; example?: string; description?: string; index: number }>[] = [
    {
      id: 'name',
      header: t('design.routes.group.headerName', 'Header'),
      autoWidth: false,
      defaultWidth: 160,
      renderCell: (row) => (
        <InputBox
          value={row.name}
          onChange={(next) => { setHeaders(headers.map((h, i) => (i === row.index ? { ...h, name: next } : h))) }}
          options={{ type: 'text', ariaLabel: t('design.routes.group.headerName', 'Header') }}
          data-testid={`design-group-header-name-${row.index}`}
        />
      )
    },
    {
      id: 'example',
      header: t('design.schema.columns.example', 'Example'),
      autoWidth: false,
      defaultWidth: 160,
      renderCell: (row) => (
        <InputBox
          value={row.example ?? ''}
          onChange={(next) => {
            setHeaders(headers.map((h, i) => {
              if (i !== row.index) return h
              const { example: _dropped, ...rest } = h
              return next === '' ? rest : { ...rest, example: next }
            }))
          }}
          options={{ type: 'text', ariaLabel: t('design.schema.columns.example', 'Example') }}
          data-testid={`design-group-header-example-${row.index}`}
        />
      )
    },
    {
      id: 'description',
      header: t('design.schema.fields.description', 'Description'),
      renderCell: (row) => (
        <div className="design-param-description">
          <InputBox
            value={row.description ?? ''}
            onChange={(next) => {
              setHeaders(headers.map((h, i) => {
                if (i !== row.index) return h
                const { description: _dropped, ...rest } = h
                return next === '' ? rest : { ...rest, description: next }
              }))
            }}
            options={{ type: 'text', ariaLabel: t('design.schema.fields.description', 'Description') }}
            data-testid={`design-group-header-description-${row.index}`}
          />
          <HeaderHoverTooltip label={t('design.routes.group.deleteHeader', 'Delete the header')}>
            <Button
              secondary
              small
              icon="trash"
              options={{ ariaLabel: t('design.routes.group.deleteHeader', 'Delete the header') }}
              onClick={() => { setHeaders(headers.filter((_, i) => i !== row.index)) }}
              data-testid={`design-group-header-delete-${row.index}`}
            />
          </HeaderHoverTooltip>
        </div>
      )
    }
  ]

  const authOptions = [
    { text: t('design.routes.group.authInherited', 'Design default') },
    ...AUTH_KINDS.map((kind) => ({ text: t(`design.auth.${kind}`, kind) }))
  ]
  const authIndex = group.design?.auth === undefined ? 0 : Math.max(0, AUTH_KINDS.indexOf(group.design.auth) + 1)

  return (
    <>
      <DesignIssuesCallout issues={issues} entityId={group.id} />
      <div className="design-model-card-header">
        <EditableLabel
          value={group.doc.name}
          onChange={(next) => { replaceGroup(design, group.id, { ...group, doc: { ...group.doc, name: next } }) }}
          as="h2"
          placeholder={t('design.schema.unnamed', '(unnamed)')}
          data-testid="design-group-name"
        />
        <HeaderHoverTooltip label={t('design.routes.addRoute', 'Add a route')}>
          <Button
            secondary
            small
            icon="add"
            options={{ ariaLabel: t('design.routes.addRoute', 'Add a route') }}
            onClick={onAddRoute}
            data-testid="design-group-add-route"
          />
        </HeaderHoverTooltip>
        <HeaderHoverTooltip label={t('sidebar.contextMenu.delete')}>
          <Button
            secondary
            small
            icon="trash"
            options={{ ariaLabel: t('sidebar.contextMenu.delete') }}
            onClick={onDelete}
            data-testid="design-group-delete"
          />
        </HeaderHoverTooltip>
      </div>

      <div className="design-settings-grid">
        <label className="design-field">
          <span className="design-field-label">{t('design.settings.api.basePath', 'Base path')}</span>
          <InputBox
            value={group.design?.basePath ?? ''}
            onChange={(next) => { patchDesignMeta({ basePath: next === '' ? undefined : next }) }}
            options={{ type: 'text', placeholder: '/users', ariaLabel: t('design.settings.api.basePath', 'Base path') }}
            data-testid="design-group-base-path"
          />
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.routes.group.versionPrefix', 'Version prefix')}</span>
          <InputBox
            value={group.design?.versionPrefix ?? ''}
            onChange={(next) => { patchDesignMeta({ versionPrefix: next === '' ? undefined : next }) }}
            options={{ type: 'text', placeholder: '/v1', ariaLabel: t('design.routes.group.versionPrefix', 'Version prefix') }}
            data-testid="design-group-version-prefix"
          />
        </label>
        <label className="design-field">
          <span className="design-field-label">{t('design.routes.group.auth', 'Required auth')}</span>
          <SelectBox
            id={`design-group-auth-${group.id}`}
            className=""
            options={authOptions}
            selected={authIndex}
            onDidSelect={(data: ISelectData) => {
              const index = authOptions.findIndex((opt) => opt.text === data.selected)
              patchDesignMeta({ auth: index <= 0 ? undefined : AUTH_KINDS[index - 1] })
            }}
            selectBoxOptions={{ ariaLabel: t('design.routes.group.auth', 'Required auth'), useCustomDrawn: true }}
            data-testid="design-group-auth"
          />
        </label>
        <label className="design-field design-field-full">
          <span className="design-field-label">{t('design.schema.fields.description', 'Description')}</span>
          <InputBox
            value={group.doc.description ?? ''}
            onChange={(next) => {
              const { description: _dropped, ...docRest } = group.doc
              replaceGroup(design, group.id, { ...group, doc: next === '' ? docRest : { ...docRest, description: next } })
            }}
            options={{ type: 'text', flexibleHeight: true, ariaLabel: t('design.schema.fields.description', 'Description') }}
            data-testid="design-group-description"
          />
        </label>
        <label className="design-field design-field-full">
          <span className="design-field-label">{t('design.tags.groupLabel', 'Shared tags')}</span>
          <DesignTagsEditor
            tags={group.doc.tags ?? []}
            onChange={(tags) => {
              const { tags: _dropped, ...docRest } = group.doc
              replaceGroup(design, group.id, { ...group, doc: tags.length > 0 ? { ...docRest, tags } : docRest })
            }}
            data-testid="design-group-tags"
          />
        </label>
      </div>

      <div className="design-route-params-header">
        <h3 className="design-settings-group-title">{t('design.routes.group.headers', 'Contract headers (inherited by routes)')}</h3>
        <HeaderHoverTooltip label={t('design.routes.group.addHeader', 'Add a header')}>
          <Button
            secondary
            small
            icon="add"
            options={{ ariaLabel: t('design.routes.group.addHeader', 'Add a header') }}
            onClick={() => { setHeaders([...headers, { name: '' }]) }}
            data-testid="design-group-add-header"
          />
        </HeaderHoverTooltip>
      </div>
      {headers.length === 0
        ? <p className="design-section-placeholder-message">{t('design.routes.group.noHeaders', 'No shared header.')}</p>
        : (
          <Table
            columns={headerColumns}
            rows={headers.map((h, index) => ({ ...h, index }))}
            getRowId={(row) => `header-${row.index}`}
          />
        )}
    </>
  )
}

// ── Route card ────────────────────────────────────────────────────────

const RouteCard: React.FC<{
  design: ApiDesign
  issues: readonly DesignIssue[]
  group: DesignRouteGroup
  route: DesignRoute
  onOpenGroup: (groupId: string) => void
}> = ({ design, issues, group, route, onOpenGroup }) => {
  const { t } = useTranslation()

  return (
    <>
      <DesignIssuesCallout issues={issues} entityId={route.id} />
      <Tabs
        data-testid="design-route-tabs"
        mountStrategy="lazy-once"
        tabs={[
          {
            id: 'definition',
            label: t('design.routes.tabs.definition', 'Definition'),
            content: <RouteDefinitionTab design={design} group={group} route={route} />
          },
          {
            id: 'responses',
            label: t('design.routes.tabs.responses', 'Responses'),
            content: <RouteResponsesTab design={design} group={group} route={route} />
          },
          {
            id: 'settings',
            label: t('design.models.tabs.settings', 'Settings'),
            content: <RouteSettingsTab design={design} group={group} route={route} onOpenGroup={onOpenGroup} />
          },
          {
            id: 'codegen',
            label: t('design.codegen.vars.tab', 'Code generation'),
            content: <DesignRouteCodegenTab design={design} group={group} route={route} />
          },
          {
            id: 'notes',
            label: t('design.models.tabs.notes', 'Notes'),
            content: (
              <div className="design-model-notes">
                <MarkdownEditor
                  key={`${route.id}-notes`}
                  initialValue={route.notes ?? ''}
                  onChange={(md: string) => {
                    const { notes: _dropped, ...routeRest } = route
                    replaceRoute(design, group.id, route.id, md === '' ? routeRest : { ...routeRest, notes: md })
                  }}
                  data-testid="design-route-notes-editor"
                />
              </div>
            )
          }
        ]}
      />
    </>
  )
}
