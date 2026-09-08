import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingEntityAction } from '../../services/designSectionIntent'
import {
  Button,
  InputBox,
  MarkdownEditor,
  Modal,
  Tabs,
  Toggle
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
import { DesignModelsListing } from './DesignModelsListing'
import { DesignIssuesCallout } from './DesignIssuesCallout'
import type { DesignEntityActionHandler } from '../../services/designSidebarNodes'

export interface DesignModelsSectionProps {
  design: ApiDesign
  issues: readonly DesignIssue[]
  selectedModelId: string | null
  onSelectModel: (modelId: string | null) => void
  onJumpTo: (section: 'models' | 'routes', entityId: string) => void
  /** A one-shot action fired from a sidebar model node's context menu. */
  pendingAction?: PendingEntityAction | null
}

/**
 * The Models section: master list on the left (filter, add), the
 * selected model's card on the right — an editable name header over
 * the Schéma / Exemples / Settings / Notes tabs. Deleting a model
 * first shows the impact (usages + inheritance children) and only
 * then strips it from the whole design.
 */
export const DesignModelsSection: React.FC<DesignModelsSectionProps> = ({ design, issues, selectedModelId, onSelectModel, onJumpTo, pendingAction }) => {
  const { t } = useTranslation()
  const [pendingDelete, setPendingDelete] = useState<DesignModel | null>(null)
  // The model whose CRUD generation is being configured (replace existing?
  // gate writes behind auth?) — null when the modal is closed.
  const [crudModel, setCrudModel] = useState<DesignModel | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)

  const selected = design.models.find((m) => m.id === selectedModelId) ?? null

  // Create a model; when `inheritsFrom` is given it becomes a sub-model of that
  // parent. Selection follows the new model so its card opens immediately.
  const createModel = useCallback((inheritsFrom?: string): void => {
    const fresh: DesignModel = {
      id: generateUniqueId(),
      doc: { name: uniqueComponentName(design, t('design.models.newName', 'NewModel')) },
      properties: [],
      ...(inheritsFrom !== undefined ? { design: { inheritsFrom } } : {})
    }
    assignDesignSection(design, 'models', [...design.models, fresh])
    onSelectModel(fresh.id)
    setSelectedPropertyId(null)
  }, [design, t, onSelectModel])

  // Run a one-shot action asked by a sidebar model node's context menu, once per
  // nonce (survives a remount): add / add-sub-model / generate-CRUD / delete —
  // delegating to the SAME handlers the section already owns (so the CRUD config
  // modal and the delete-impact modal are preserved).
  const lastActionNonce = useRef(0)
  useEffect(() => {
    if (!pendingAction || pendingAction.nonce === lastActionNonce.current) return
    lastActionNonce.current = pendingAction.nonce
    const { action, entityId } = pendingAction
    // Run the one-shot on a microtask so the state changes (open a modal, create
    // a model) don't fire synchronously inside the effect that observed them.
    queueMicrotask(() => {
      if (action === 'add') { createModel(); return }
      if (action === 'addSubModel' && entityId !== undefined) { createModel(entityId); return }
      const target = entityId !== undefined ? design.models.find((m) => m.id === entityId) ?? null : null
      if (action === 'generateCrud' && target !== null) setCrudModel(target)
      else if (action === 'delete' && target !== null) setPendingDelete(target)
    })
  }, [pendingAction, createModel, design.models])

  // The section-root listing reuses the section's own add / CRUD / delete
  // handlers (the sidebar node menus route the same actions here via the intent
  // bus; the listing is inside this component, so it calls them directly).
  const listingAction: DesignEntityActionHandler = (_d, _s, action, entityId) => {
    if (action === 'add') createModel()
    else if (action === 'addSubModel' && entityId !== undefined) createModel(entityId)
    else if (action === 'generateCrud' && entityId !== undefined) {
      const m = design.models.find((x) => x.id === entityId)
      if (m !== undefined) setCrudModel(m)
    } else if (action === 'delete' && entityId !== undefined) {
      const m = design.models.find((x) => x.id === entityId)
      if (m !== undefined) setPendingDelete(m)
    }
  }

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
    <div className="design-section design-entity-detail-section" data-testid="design-models-section">
      {selected === null ? (
        <DesignModelsListing design={design} onSelect={(id) => { onSelectModel(id); setSelectedPropertyId(null) }} onAction={listingAction} />
      ) : (
        <div className="design-entity-detail design-model-card" data-testid="design-models-detail">
          <>
            <DesignIssuesCallout issues={issues} entityId={selected.id} />
            <label className="design-field design-field-full design-model-description">
              <span className="design-field-label">{t('design.models.description', 'Description')}</span>
              <InputBox
                value={selected.doc.description ?? ''}
                onChange={(next) => {
                  const trimmed = next.trim()
                  if (trimmed === '') {
                    const { description: _drop, ...docRest } = selected.doc
                    patchModel(design, selected.id, { doc: docRest })
                  } else {
                    patchModel(design, selected.id, { doc: { ...selected.doc, description: next } })
                  }
                }}
                options={{ type: 'text', flexibleHeight: true, ariaLabel: t('design.models.description', 'Description'), placeholder: t('design.models.descriptionPlaceholder', 'What this model represents (optional)') }}
                data-testid="design-model-description"
              />
            </label>
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
        </div>
      )}

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
