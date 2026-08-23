import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  EditableLabel,
  InputBox,
  ListView,
  MarkdownEditor,
  Modal,
  ScrollableElement,
  SelectBox,
  StaticPane,
  Table,
  Tabs,
  usePersistedState,
  type ContextMenuItem,
  type ISelectData,
  type ListViewItemData,
  type TableColumn
} from 'electron-core-ui/renderer'
import type {
  ApiDesign,
  DesignAuthKind,
  DesignRoute,
  DesignRouteGroup
} from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { httpBadgeIdFor } from '../../../../shared/utils/httpMethod'
import { generateUniqueId } from '../../utils/treeManipulation'
import { RegistryBadge } from '../common/RegistryBadge'
import { assignDesignSection, replaceGroup, replaceRoute } from './designMutations'
import { RouteDefinitionTab } from './RouteDefinitionTab'
import { RouteResponsesTab } from './RouteResponsesTab'
import { RouteSettingsTab } from './RouteSettingsTab'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

const AUTH_KINDS: readonly DesignAuthKind[] = ['none', 'bearer', 'apiKeyHeader', 'basic']

export interface DesignRoutesSectionProps {
  design: ApiDesign
  issues: readonly DesignIssue[]
  selectedEntityId: string | null
  onSelectEntity: (entityId: string | null) => void
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
export const DesignRoutesSection: React.FC<DesignRoutesSectionProps> = ({ design, issues, selectedEntityId, onSelectEntity }) => {
  const { t } = useTranslation()
  // Persisted per design (user setting, NOT the .restorm file): the fold state
  // of the route groups survives tab switches AND file reopen.
  const [expandedGroupIds, setExpandedGroupIds] = usePersistedState<string[]>(
    `design-routes-expanded:${design.id}`,
    design.routeGroups.map((g) => g.id)
  )
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<DesignRouteGroup | null>(null)
  const [filter, setFilter] = useState('')
  const expandAll = (): void => { setExpandedGroupIds(design.routeGroups.map((g) => g.id)) }
  const collapseAll = (): void => { setExpandedGroupIds([]) }

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

  const addGroup = useCallback(() => {
    const taken = new Set(design.routeGroups.map((g) => g.doc.name))
    let name = t('design.routes.newGroupName', 'NewGroup')
    for (let i = 2; taken.has(name); i++) name = `${t('design.routes.newGroupName', 'NewGroup')}${i}`
    const fresh: DesignRouteGroup = {
      id: generateUniqueId(),
      doc: { name },
      design: { basePath: `/${name.toLowerCase()}` },
      routes: []
    }
    assignDesignSection(design, 'routeGroups', [...design.routeGroups, fresh])
    setExpandedGroupIds((prev) => [...prev, fresh.id])
    onSelectEntity(fresh.id)
  }, [design, onSelectEntity, t, setExpandedGroupIds])

  const addRoute = useCallback((group: DesignRouteGroup) => {
    const fresh: DesignRoute = {
      id: generateUniqueId(),
      doc: {
        match: { urlPattern: '/', method: 'GET' },
        responses: { '200': { description: 'OK' } }
      }
    }
    replaceGroup(design, group.id, { ...group, routes: [...group.routes, fresh] })
    setExpandedGroupIds((prev) => (prev.includes(group.id) ? prev : [...prev, group.id]))
    onSelectEntity(fresh.id)
  }, [design, onSelectEntity, setExpandedGroupIds])

  const deleteRoute = useCallback((group: DesignRouteGroup, routeId: string) => {
    replaceGroup(design, group.id, { ...group, routes: group.routes.filter((r) => r.id !== routeId) })
    if (selectedEntityId === routeId) onSelectEntity(group.id)
  }, [design, onSelectEntity, selectedEntityId])

  const confirmDeleteGroup = useCallback(() => {
    if (pendingDeleteGroup === null) return
    assignDesignSection(design, 'routeGroups', design.routeGroups.filter((g) => g.id !== pendingDeleteGroup.id))
    if (selection?.group.id === pendingDeleteGroup.id) onSelectEntity(null)
    setPendingDeleteGroup(null)
  }, [design, onSelectEntity, pendingDeleteGroup, selection])

  // ── Tree rows ──────────────────────────────────────────────────────
  const rows: ListViewItemData[] = useMemo(() => {
    const hasIssue = (entityId: string): boolean => issues.some((issue) => issue.path.includes(entityId))
    const term = filter.trim().toLowerCase()
    const routeTitle = (route: DesignRouteGroup['routes'][number]): string =>
      route.doc.summary !== undefined && route.doc.summary !== '' ? route.doc.summary : route.doc.match.urlPattern
    const out: ListViewItemData[] = []
    for (const group of design.routeGroups) {
      const groupMatches = term === '' || group.doc.name.toLowerCase().includes(term)
      // A matching group shows all its routes; otherwise only routes that match.
      const visibleRoutes = term === '' || groupMatches
        ? group.routes
        : group.routes.filter((r) => routeTitle(r).toLowerCase().includes(term))
      if (term !== '' && !groupMatches && visibleRoutes.length === 0) continue
      const groupMenu: ContextMenuItem[] = [
        { id: 'add-route', label: t('design.routes.addRoute', 'Add a route'), icon: 'add', onClick: () => { addRoute(group) } },
        { id: 'delete-group', label: t('sidebar.contextMenu.delete'), icon: 'trash', onClick: () => { setPendingDeleteGroup(group) } }
      ]
      out.push({
        id: group.id,
        title: group.doc.name === '' ? t('design.schema.unnamed', '(unnamed)') : group.doc.name,
        isExpandable: true,
        // While filtering, keep matching groups open so hits are visible.
        isExpanded: term !== '' ? true : expandedGroupIds.includes(group.id),
        contextMenuItems: groupMenu,
        ...(hasIssue(group.id) ? { rightActions: <span className="design-list-error-dot codicon codicon-error" /> } : {}),
        children: visibleRoutes.map((route) => {
          const routeMenu: ContextMenuItem[] = [
            { id: 'delete-route', label: t('sidebar.contextMenu.delete'), icon: 'trash', onClick: () => { deleteRoute(group, route.id) } }
          ]
          // The row reads like a request row: method badge LEFT (the icon
          // slot), the SUMMARY as the label (an API turned into a design
          // makes the route's name its summary), pattern as fallback.
          return {
            id: route.id,
            title: routeTitle(route),
            icon: <RegistryBadge badgeId={httpBadgeIdFor(route.doc.match.method ?? 'GET')} text={route.doc.match.method ?? 'GET'} />,
            contextMenuItems: routeMenu,
            ...(hasIssue(route.id) ? { rightActions: <span className="design-list-error-dot codicon codicon-error" /> } : {})
          }
        })
      })
    }
    return out
  }, [design.routeGroups, expandedGroupIds, issues, t, addRoute, deleteRoute, filter])

  const selectedGroup = selection?.group ?? null
  const selectedRoute = selection?.route ?? null

  return (
    <div className="design-section design-entity-list-section" data-testid="design-routes-section">
      <StaticPane
        className="design-entity-list"
        data-testid="design-routes-list"
        title={t('design.section.routes')}
        headerActions={
          <>
            <HeaderHoverTooltip label={t('design.models.collapseAll', 'Collapse all')}>
              <Button
                secondary
                small
                icon="collapse-all"
                options={{ ariaLabel: t('design.models.collapseAll', 'Collapse all') }}
                onClick={collapseAll}
                data-testid="design-routes-collapse-all"
              />
            </HeaderHoverTooltip>
            <HeaderHoverTooltip label={t('design.models.expandAll', 'Expand all')}>
              <Button
                secondary
                small
                icon="expand-all"
                options={{ ariaLabel: t('design.models.expandAll', 'Expand all') }}
                onClick={expandAll}
                data-testid="design-routes-expand-all"
              />
            </HeaderHoverTooltip>
            <HeaderHoverTooltip label={t('design.routes.addGroup', 'Add a group')}>
              <Button
                secondary
                small
                icon="add"
                options={{ ariaLabel: t('design.routes.addGroup', 'Add a group') }}
                onClick={addGroup}
                data-testid="design-routes-add-group"
              />
            </HeaderHoverTooltip>
          </>
        }
      >
        <InputBox
          value={filter}
          onChange={setFilter}
          options={{ type: 'text', placeholder: t('design.list.filter', 'Filter…'), ariaLabel: t('design.list.filter', 'Filter…') }}
          data-testid="design-routes-filter"
        />
        <ScrollableElement className="design-entity-list-scroll">
          <ListView
            items={rows}
            rootRole="tree"
            ariaLabel={t('design.section.routes')}
            selectedIds={selectedEntityId === null ? [] : [selectedEntityId]}
            onItemClick={(payload) => { onSelectEntity(payload.item.id) }}
            onItemToggle={(payload, expanded) => {
              setExpandedGroupIds((prev) => (
                expanded ? [...prev.filter((id) => id !== payload.item.id), payload.item.id] : prev.filter((id) => id !== payload.item.id)
              ))
            }}
            disableDrag
            data-testid="design-routes-listview"
          />
        </ScrollableElement>
      </StaticPane>

      <div className="design-entity-detail design-model-card" data-testid="design-routes-detail">
        {selection === null && (
          <p className="design-section-placeholder-message">
            {t('design.routes.selectPrompt', 'Select a group or a route, or create a group.')}
          </p>
        )}
        {selectedGroup !== null && selectedRoute === null && (
          <GroupCard
            key={selectedGroup.id}
            design={design}
            group={selectedGroup}
            onAddRoute={() => { addRoute(selectedGroup) }}
            onDelete={() => { setPendingDeleteGroup(selectedGroup) }}
          />
        )}
        {selectedGroup !== null && selectedRoute !== null && (
          <RouteCard
            key={selectedRoute.id}
            design={design}
            group={selectedGroup}
            route={selectedRoute}
            onOpenGroup={(groupId) => { onSelectEntity(groupId) }}
          />
        )}
      </div>

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
  group: DesignRouteGroup
  onAddRoute: () => void
  onDelete: () => void
}> = ({ design, group, onAddRoute, onDelete }) => {
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
  group: DesignRouteGroup
  route: DesignRoute
  onOpenGroup: (groupId: string) => void
}> = ({ design, group, route, onOpenGroup }) => {
  const { t } = useTranslation()
  const method = route.doc.match.method ?? 'GET'

  const setSummary = (next: string): void => {
    const { summary: _dropped, ...docRest } = route.doc
    replaceRoute(design, group.id, route.id, { ...route, doc: next === '' ? docRest : { ...docRest, summary: next } })
  }

  return (
    <>
      <div className="design-model-card-header">
        <RegistryBadge badgeId={httpBadgeIdFor(method)} text={method} />
        {/* The SUMMARY is the route's display name — edited here like a
            request's name (hover pencil), not in a form field below. */}
        <EditableLabel
          value={route.doc.summary ?? ''}
          onChange={setSummary}
          as="h2"
          placeholder={route.doc.match.urlPattern}
          data-testid="design-route-summary-label"
        />
        <span className="design-route-card-group">{group.doc.name}</span>
      </div>
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
