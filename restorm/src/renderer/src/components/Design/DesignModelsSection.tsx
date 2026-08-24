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
  StaticPane,
  Tabs,
  Toggle,
  usePersistedState,
  type ListViewDropPosition,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { ApiDesign, DesignModel, DesignRouteGroup } from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { collectInheritanceChildren, collectModelUsages, removeModelFromDesign } from '../../../../shared/design/designUsages'
import { generateCrud, findCrudGroupForModel } from '../../../../shared/design/designRoutes'
import { summarizeGroupProjections } from '../../../../shared/design/designProjections'
import { generateUniqueId } from '../../utils/treeManipulation'
import { assignDesignSection, patchModel, replaceModel, uniqueComponentName } from './designMutations'
import { ModelSchemaTab } from './ModelSchemaTab'
import { ModelExamplesTab } from './ModelExamplesTab'
import { ModelSettingsTab } from './ModelSettingsTab'
import { DesignModelCodegenTab } from './DesignModelCodegenTab'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

export interface DesignModelsSectionProps {
  design: ApiDesign
  issues: readonly DesignIssue[]
  selectedModelId: string | null
  onSelectModel: (modelId: string | null) => void
  onJumpTo: (section: 'models' | 'routes', entityId: string) => void
}

/**
 * The Models section: master list on the left (filter, add), the
 * selected model's card on the right — an editable name header over
 * the Schéma / Exemples / Settings / Notes tabs. Deleting a model
 * first shows the impact (usages + inheritance children) and only
 * then strips it from the whole design.
 */
export const DesignModelsSection: React.FC<DesignModelsSectionProps> = ({ design, issues, selectedModelId, onSelectModel, onJumpTo }) => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [pendingDelete, setPendingDelete] = useState<DesignModel | null>(null)
  // The model whose CRUD generation is being configured (replace existing?
  // gate writes behind auth?) — null when the modal is closed.
  const [crudModel, setCrudModel] = useState<DesignModel | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  // Which list row is in inline-rename mode (F2, the row menu, or straight
  // after creation) — mirrors the custom-enum-list editor.
  const [editingId, setEditingId] = useState<string | null>(null)
  // Track only EXPLICITLY collapsed nodes, so the tree is fully expanded by
  // default. Persisted per design (user setting, NOT the .restorm file) so the
  // fold state survives tab switches AND file reopen.
  const [collapsedList, setCollapsedList] = usePersistedState<string[]>(`design-models-collapsed:${design.id}`, [])
  const collapsedIds = useMemo(() => new Set(collapsedList), [collapsedList])

  const selected = design.models.find((m) => m.id === selectedModelId) ?? null

  // Create a model; when `inheritsFrom` is given it becomes a sub-model of that
  // parent (the parent is expanded so the new child shows), and either way we
  // drop straight into inline name editing like the custom-enum lists.
  const createModel = useCallback((inheritsFrom?: string): void => {
    const fresh: DesignModel = {
      id: generateUniqueId(),
      doc: { name: uniqueComponentName(design, t('design.models.newName', 'NewModel')) },
      properties: [],
      ...(inheritsFrom !== undefined ? { design: { inheritsFrom } } : {})
    }
    assignDesignSection(design, 'models', [...design.models, fresh])
    if (inheritsFrom !== undefined) setCollapsedList((prev) => prev.filter((id) => id !== inheritsFrom))
    onSelectModel(fresh.id)
    setSelectedPropertyId(null)
    setEditingId(fresh.id)
  }, [design, t, setCollapsedList, onSelectModel])
  const addModel = (): void => { createModel() }

  const renameModel = (id: string, name: string): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    const m = design.models.find((x) => x.id === id)
    if (m) patchModel(design, id, { doc: { ...m.doc, name: trimmed } })
  }

  // ── Hierarchy: children-by-parent + roots, derived from inheritsFrom ──
  const { childMap, roots } = useMemo(() => {
    const map = new Map<string, DesignModel[]>()
    const ids = new Set(design.models.map((m) => m.id))
    const rootList: DesignModel[] = []
    for (const m of design.models) {
      const parent = m.design?.inheritsFrom
      if (parent !== undefined && ids.has(parent)) {
        const arr = map.get(parent) ?? []
        arr.push(m)
        map.set(parent, arr)
      } else rootList.push(m)
    }
    return { childMap: map, roots: rootList }
  }, [design.models])

  // Every id in the subtree rooted at `rootId` (itself + all descendants): the
  // set a model may NEVER inherit from, or a cycle forms.
  const subtreeIds = useCallback((rootId: string): Set<string> => {
    const out = new Set<string>([rootId])
    const stack = [rootId]
    while (stack.length > 0) {
      const id = stack.pop()
      if (id === undefined) break
      for (const child of childMap.get(id) ?? []) {
        if (!out.has(child.id)) { out.add(child.id); stack.push(child.id) }
      }
    }
    return out
  }, [childMap])

  const buildRow = useCallback((m: DesignModel, children: ListViewItemData[]): ListViewItemData => ({
    id: m.id,
    title: m.doc.name === '' ? t('design.schema.unnamed', '(unnamed)') : m.doc.name,
    // The CRUD generator is reachable from BOTH the model card (Settings tab)
    // and this row menu; "Add a sub-model" creates a child with the inheritance.
    contextMenuItems: [{
      id: 'rename',
      label: t('sidebar.contextMenu.rename'),
      icon: 'edit',
      onClick: () => { setEditingId(m.id) }
    }, {
      id: 'add-sub-model',
      label: t('design.models.addSubModel', 'Add a sub-model'),
      icon: 'add',
      onClick: () => { createModel(m.id) }
    }, {
      id: 'generate-crud',
      label: t('design.modelSettings.generateCrud', 'Generate the CRUD'),
      icon: 'type-hierarchy-sub',
      onClick: () => { setCrudModel(m) }
    }, {
      id: 'delete',
      label: t('design.models.delete', 'Delete the model'),
      icon: 'trash',
      onClick: () => { setPendingDelete(m) }
    }],
    ...(children.length > 0 ? { children, isExpandable: true, isExpanded: !collapsedIds.has(m.id) } : {}),
    rightActions: (
      <span className="design-list-detail">
        {issues.some((issue) => issue.path.includes(m.id)) && <span className="design-list-error-dot codicon codicon-error" data-testid={`design-model-error-${m.id}`} />}
        {t('design.models.propertyCount', '{{count}} props', { count: m.properties.length })}
      </span>
    )
  }), [t, issues, collapsedIds, createModel])

  const rows: ListViewItemData[] = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (term !== '') {
      // While searching, flatten to matching models — no hierarchy.
      return design.models.filter((m) => m.doc.name.toLowerCase().includes(term)).map((m) => buildRow(m, []))
    }
    const build = (m: DesignModel, visited: Set<string>): ListViewItemData => {
      if (visited.has(m.id)) return buildRow(m, []) // defensive: never recurse a cycle
      const next = new Set(visited).add(m.id)
      return buildRow(m, (childMap.get(m.id) ?? []).map((c) => build(c, next)))
    }
    return roots.map((m) => build(m, new Set()))
  }, [design.models, filter, buildRow, childMap, roots])

  // Drag a model onto another to change its inheritance ("into"), or between
  // siblings to reorder + adopt the target's parent. A model can never inherit
  // from itself or one of its descendants (cycle) — refused live in canDrop.
  const canDropModel = useCallback((draggedId: string, targetId: string, position: ListViewDropPosition): boolean => {
    if (draggedId === targetId) return false
    const target = design.models.find((m) => m.id === targetId)
    if (!target) return false
    const newParent = position === 'into' ? targetId : target.design?.inheritsFrom
    if (newParent === undefined) return true
    return !subtreeIds(draggedId).has(newParent)
  }, [design.models, subtreeIds])

  const moveModel = useCallback((draggedId: string, targetId: string, position: ListViewDropPosition): void => {
    if (!canDropModel(draggedId, targetId, position)) return
    const dragged = design.models.find((m) => m.id === draggedId)
    const target = design.models.find((m) => m.id === targetId)
    if (!dragged || !target) return
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
    if (position === 'into') setCollapsedList((prev) => prev.filter((id) => id !== targetId))
    assignDesignSection(design, 'models', without)
  }, [design, canDropModel, setCollapsedList])

  // Controlled expanded set for the ListView = every model NOT explicitly
  // collapsed (default: all expanded). Expand-all clears the collapsed set;
  // collapse-all collapses every model that has children.
  const expandedIdList = useMemo(
    () => design.models.filter((m) => !collapsedIds.has(m.id)).map((m) => m.id),
    [design.models, collapsedIds]
  )
  const expandAll = (): void => { setCollapsedList([]) }
  const collapseAll = (): void => { setCollapsedList(Array.from(childMap.keys())) }

  const confirmDelete = (): void => {
    if (pendingDelete === null) return
    const next = removeModelFromDesign(design, pendingDelete.id)
    assignDesignSection(design, 'models', next.models)
    assignDesignSection(design, 'routeGroups', next.routeGroups)
    if (selectedModelId === pendingDelete.id) onSelectModel(null)
    setPendingDelete(null)
  }

  const deleteImpact = useMemo(() => {
    if (pendingDelete === null) return { usages: [], children: [] as DesignModel[] }
    return {
      usages: collectModelUsages(design, pendingDelete.id),
      children: collectInheritanceChildren(design, pendingDelete.id)
    }
  }, [design, pendingDelete])

  return (
    <div className="design-section design-entity-list-section" data-testid="design-models-section">
      <StaticPane
        className="design-entity-list"
        data-testid="design-models-list"
        title={t('design.section.models')}
        headerActions={
          <>
            <HeaderHoverTooltip label={t('design.models.collapseAll', 'Collapse all')}>
              <Button
                secondary
                small
                icon="collapse-all"
                options={{ ariaLabel: t('design.models.collapseAll', 'Collapse all') }}
                onClick={collapseAll}
                data-testid="design-models-collapse-all"
              />
            </HeaderHoverTooltip>
            <HeaderHoverTooltip label={t('design.models.expandAll', 'Expand all')}>
              <Button
                secondary
                small
                icon="expand-all"
                options={{ ariaLabel: t('design.models.expandAll', 'Expand all') }}
                onClick={expandAll}
                data-testid="design-models-expand-all"
              />
            </HeaderHoverTooltip>
            <HeaderHoverTooltip label={t('design.models.add', 'Add a model')}>
              <Button
                secondary
                small
                icon="add"
                options={{ ariaLabel: t('design.models.add', 'Add a model') }}
                onClick={addModel}
                data-testid="design-models-add"
              />
            </HeaderHoverTooltip>
          </>
        }
      >
        <InputBox
          value={filter}
          onChange={setFilter}
          options={{ type: 'text', placeholder: t('design.list.filter', 'Filter…'), ariaLabel: t('design.list.filter', 'Filter…') }}
          data-testid="design-models-filter"
        />
        <ScrollableElement className="design-entity-list-scroll">
          <ListView
            items={rows}
            selectedIds={selectedModelId === null ? [] : [selectedModelId]}
            onItemClick={(payload) => { onSelectModel(payload.item.id); setSelectedPropertyId(null) }}
            editingItemId={editingId}
            onEditingStart={(id) => { setEditingId(id) }}
            onEditingEnd={() => { setEditingId(null) }}
            onItemRename={(payload, newValue) => { renameModel(payload.item.id, newValue) }}
            expandedIds={expandedIdList}
            onItemToggle={(payload, expanded) => {
              setCollapsedList((prev) => expanded
                ? prev.filter((id) => id !== payload.item.id)
                : (prev.includes(payload.item.id) ? prev : [...prev, payload.item.id]))
            }}
            canDrop={(sources, target, position) => {
              const draggedId = sources[0]?.item.id
              return sources.length === 1 && draggedId !== undefined && canDropModel(draggedId, target.item.id, position)
            }}
            onItemDrop={(payload) => {
              if (payload.sources.length === 1) moveModel(payload.source.id, payload.item.id, payload.position)
            }}
            data-testid="design-models-listview"
          />
        </ScrollableElement>
      </StaticPane>

      <div className="design-entity-detail design-model-card" data-testid="design-models-detail">
        {selected === null ? (
          <p className="design-section-placeholder-message">
            {t('design.models.selectPrompt', 'Select a model, or create one.')}
          </p>
        ) : (
          <>
            <div className="design-model-card-header">
              <EditableLabel
                value={selected.doc.name}
                onChange={(next) => { patchModel(design, selected.id, { doc: { ...selected.doc, name: next } }) }}
                as="h2"
                editable
                placeholder={t('design.schema.unnamed', '(unnamed)')}
                data-testid="design-model-name"
              />
              {(
                <HeaderHoverTooltip label={t('design.models.delete', 'Delete the model')}>
                  <Button
                    secondary
                    small
                    icon="trash"
                    options={{ ariaLabel: t('design.models.delete', 'Delete the model') }}
                    onClick={() => { setPendingDelete(selected) }}
                    data-testid="design-model-delete"
                  />
                </HeaderHoverTooltip>
              )}
            </div>
            <Tabs
              data-testid="design-model-tabs"
              mountStrategy="lazy-once"
              tabs={[
                {
                  id: 'schema',
                  label: t('design.models.tabs.schema', 'Schema'),
                  content: (
                    <ModelSchemaTab
                      design={design}
                      model={selected}
                      issues={issues}
                      selectedPropertyId={selectedPropertyId}
                      onSelectProperty={setSelectedPropertyId}
                      onJumpToModel={(modelId) => { onSelectModel(modelId); setSelectedPropertyId(null) }}
                    />
                  )
                },
                {
                  id: 'examples',
                  label: t('design.models.tabs.examples', 'Examples'),
                  content: <ModelExamplesTab design={design} model={selected} />
                },
                {
                  id: 'settings',
                  label: t('design.models.tabs.settings', 'Settings'),
                  content: <ModelSettingsTab design={design} model={selected} onJumpTo={onJumpTo} onGenerateCrud={setCrudModel} />
                },
                {
                  id: 'codegen',
                  label: t('design.codegen.vars.tab', 'Code generation'),
                  content: <DesignModelCodegenTab design={design} model={selected} />
                },
                {
                  id: 'notes',
                  label: t('design.models.tabs.notes', 'Notes'),
                  content: (
                    <div className="design-model-notes">
                      <MarkdownEditor
                        key={`${selected.id}-notes`}
                        initialValue={selected.notes ?? ''}
                        onChange={(md: string) => {
                          const { notes: _dropped, ...modelRest } = selected
                          replaceModel(design, selected.id, md === '' ? modelRest : { ...modelRest, notes: md })
                        }}
                        data-testid="design-model-notes-editor"
                      />
                    </div>
                  )
                }
              ]}
            />
          </>
        )}
      </div>

      {pendingDelete !== null && (
        <Modal
          title={t('design.models.deleteTitle', 'Delete {{name}}?', { name: pendingDelete.doc.name })}
          isOpen
          onClose={() => { setPendingDelete(null) }}
          size="dialog"
          data-testid="design-model-delete-modal"
          enterActionTestId="design-model-delete-confirm"
        >
          <div className="design-delete-modal-body">
            {deleteImpact.usages.length === 0 && deleteImpact.children.length === 0 ? (
              <p>{t('design.models.deleteNoImpact', 'This model is not used anywhere.')}</p>
            ) : (
              <>
                <p>{t('design.models.deleteImpactIntro', 'Deleting this model will update:')}</p>
                <ul className="design-delete-impact-list" data-testid="design-model-delete-impact">
                  {deleteImpact.children.map((child) => (
                    <li key={`child-${child.id}`}>
                      {t('design.models.deleteImpactChild', '{{name}} loses its inheritance (its own properties stay)', { name: child.doc.name })}
                    </li>
                  ))}
                  {deleteImpact.usages.filter((u) => u.kind !== 'modelInheritance').map((usage, index) => (
                    <li key={`usage-${index}`}>
                      {usage.label}
                      {usage.detail !== undefined ? ` · ${usage.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="design-delete-modal-actions">
              <Button secondary onClick={() => { setPendingDelete(null) }} data-testid="design-model-delete-cancel">
                {t('sidebar.deleteConfirm.cancel')}
              </Button>
              <Button onClick={confirmDelete} data-testid="design-model-delete-confirm">
                {t('sidebar.deleteConfirm.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {crudModel !== null && (
        <CrudGenerationModal
          design={design}
          model={crudModel}
          existingGroup={findCrudGroupForModel(design, crudModel)}
          onClose={() => { setCrudModel(null) }}
          onConfirm={({ replace, authWrites }) => {
            const model = crudModel
            const { group } = generateCrud(design, model, generateUniqueId, { authWrites })
            const existing = findCrudGroupForModel(design, model)
            const nextGroups = replace && existing !== undefined
              ? design.routeGroups.map((g) => (g.id === existing.id ? group : g))
              : [...design.routeGroups, group]
            assignDesignSection(design, 'routeGroups', nextGroups)
            setCrudModel(null)
            onJumpTo('routes', group.id)
          }}
        />
      )}
    </div>
  )
}

/**
 * Configure a CRUD generation before it runs: when routes already exist
 * for this model, offer to REPLACE them (rather than silently duplicate),
 * and optionally gate the write routes behind bearer auth in one go — the
 * two frictions the usability pass surfaced.
 */
const CrudGenerationModal: React.FC<{
  design: ApiDesign
  model: DesignModel
  existingGroup: DesignRouteGroup | undefined
  onClose: () => void
  onConfirm: (options: { replace: boolean; authWrites: boolean }) => void
}> = ({ design, model, existingGroup, onClose, onConfirm }) => {
  const { t } = useTranslation()
  const hasExisting = existingGroup !== undefined
  const [replace, setReplace] = useState(true)
  const [authWrites, setAuthWrites] = useState(false)

  // Preview the multi-protocol surface this CRUD creates, by generating the
  // group in memory (pure) and running the same projections the server uses.
  // authWrites doesn't change the projected shape, so it's not a dependency.
  const projections = useMemo(() => {
    let n = 0
    const { group } = generateCrud(design, model, () => `crud-preview-${n++}`)
    return summarizeGroupProjections({ ...design, routeGroups: [...design.routeGroups, group] }, group)
  }, [design, model])

  return (
    <Modal
      title={t('design.crud.title', 'Generate CRUD for {{name}}', { name: model.doc.name })}
      isOpen
      onClose={onClose}
      size="dialog"
      data-testid="design-crud-modal"
      enterActionTestId="design-crud-confirm"
    >
      <div className="design-crud-modal-body">
        {hasExisting && (
          <label className="design-crud-option">
            <Toggle
              checked={replace}
              onChange={setReplace}
              aria-label={t('design.crud.replace', 'Replace the existing routes')}
              data-testid="design-crud-replace"
            />
            <span className="design-crud-option-text">
              <span className="design-crud-option-label">{t('design.crud.replace', 'Replace the existing routes')}</span>
              <span className="design-crud-option-hint">
                {t('design.crud.replaceHint', 'Routes already exist for this model. Replace them to avoid duplicates; leave off to add a second set.')}
              </span>
            </span>
          </label>
        )}
        <label className="design-crud-option">
          <Toggle
            checked={authWrites}
            onChange={setAuthWrites}
            aria-label={t('design.crud.authWrites', 'Protect write routes with authentication')}
            data-testid="design-crud-auth-writes"
          />
          <span className="design-crud-option-text">
            <span className="design-crud-option-label">{t('design.crud.authWrites', 'Protect write routes with authentication')}</span>
            <span className="design-crud-option-hint">
              {t('design.crud.authWritesHint', 'Require bearer auth on create, update and delete; reads stay public.')}
            </span>
          </span>
        </label>
        <div className="design-crud-projections" data-testid="design-crud-projections">
          <span className="design-crud-projections-title">
            {t('design.crud.projections.title', 'One model, every protocol — this CRUD is also served as:')}
          </span>
          <ul className="design-crud-projections-list">
            <li>{t('design.crud.projections.http', '{{count}} REST routes', { count: projections.http })}</li>
            <li>{t('design.crud.projections.graphql', '{{queries}} queries / {{mutations}} mutations in GraphQL', { queries: projections.graphqlQueries, mutations: projections.graphqlMutations })}</li>
            <li>{t('design.crud.projections.grpc', '{{count}} gRPC methods', { count: projections.grpc })}</li>
            <li>{t('design.crud.projections.odata', '{{count}} OData entity set', { count: projections.odataEntitySets })}</li>
            <li>{t('design.crud.projections.soap', '{{count}} SOAP operations', { count: projections.soap })}</li>
          </ul>
        </div>
        <div className="design-crud-modal-actions">
          <Button secondary onClick={onClose} data-testid="design-crud-cancel">
            {t('sidebar.deleteConfirm.cancel')}
          </Button>
          <Button onClick={() => { onConfirm({ replace: hasExisting && replace, authWrites }) }} data-testid="design-crud-confirm">
            {t('design.crud.generate', 'Generate')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
