import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  EditableLabel,
  InputBox,
  ListView,
  MarkdownEditor,
  Modal,
  ScrollableElement,
  Tabs,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { ApiDesign, DesignModel } from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { collectInheritanceChildren, collectModelUsages, removeModelFromDesign } from '../../../../shared/design/designUsages'
import { generateUniqueId } from '../../utils/treeManipulation'
import { assignDesignSection, patchModel, replaceModel, uniqueComponentName } from './designMutations'
import { ModelSchemaTab } from './ModelSchemaTab'
import { ModelExamplesTab } from './ModelExamplesTab'
import { ModelSettingsTab } from './ModelSettingsTab'
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
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)

  const selected = design.models.find((m) => m.id === selectedModelId) ?? null

  const rows: ListViewItemData[] = useMemo(() =>
    design.models
      .filter((m) => m.doc.name.toLowerCase().includes(filter.toLowerCase()))
      .map((m) => ({
        id: m.id,
        title: m.doc.name === '' ? t('design.schema.unnamed', '(unnamed)') : m.doc.name,
        rightActions: (
          <span className="design-list-detail">
            {issues.some((issue) => issue.path.includes(m.id)) && <span className="design-list-error-dot codicon codicon-error" data-testid={`design-model-error-${m.id}`} />}
            {t('design.models.propertyCount', '{{count}} props', { count: m.properties.length })}
          </span>
        )
      })), [design.models, filter, issues, t])

  const addModel = (): void => {
    const fresh: DesignModel = {
      id: generateUniqueId(),
      doc: { name: uniqueComponentName(design, t('design.models.newName', 'NewModel')) },
      properties: []
    }
    assignDesignSection(design, 'models', [...design.models, fresh])
    onSelectModel(fresh.id)
    setSelectedPropertyId(null)
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
    <div className="design-section design-entity-list-section" data-testid="design-models-section">
      <div className="design-entity-list" data-testid="design-models-list">
        <div className="design-entity-list-header">
          <h2 className="design-section-title">{t('design.section.models')}</h2>
          {(
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
          )}
        </div>
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
            disableDrag
            data-testid="design-models-listview"
          />
        </ScrollableElement>
      </div>

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
                  <button
                    type="button"
                    className="design-icon-button"
                    aria-label={t('design.models.delete', 'Delete the model')}
                    onClick={() => { setPendingDelete(selected) }}
                    data-testid="design-model-delete"
                  >
                    <span className="codicon codicon-trash" />
                  </button>
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
                  content: <ModelSettingsTab design={design} model={selected} onJumpTo={onJumpTo} />
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
    </div>
  )
}
