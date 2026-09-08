import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, Modal, Button } from 'electron-core-ui/renderer'
import type { ApiDesign, DesignEnum, CustomValueList } from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { DesignIssuesCallout } from './DesignIssuesCallout'
import { CustomValueListsEditor } from '../Folders/CustomValueListsEditor'
import { assignDesignSection, uniqueComponentName } from './designMutations'
import { removeEnumFromDesign } from '../../../../shared/design/designUsages'
import { generateUniqueId } from '../../utils/treeManipulation'
import { bridgeEnumValues, displayValue } from './designDisplay'
import { setPendingDesignSection, type PendingEntityAction } from '../../services/designSectionIntent'
import { DesignEntityListing } from './DesignEntityListing'

/**
 * The Enums section of the Design tab: the SAME master-details editor
 * as the env folder's custom value lists, bridged onto the design's
 * enums. The bridge is the settled answer to the shared-model question:
 * `doc.enumValues` stays the only stored truth (importer/exporter
 * compatible), and each render maps it to the editor's list shape —
 * single column (no label/value split, no enable toggle), the row text
 * IS the enum value.
 */
export const DesignEnumsSection: React.FC<{
  design: ApiDesign
  issues?: readonly DesignIssue[]
  pendingAction?: PendingEntityAction | null
  selectedEnumId?: string | null
  onSelectEnum?: (id: string | null) => void
}> = ({ design, issues = [], pendingAction, selectedEnumId = null, onSelectEnum }) => {
  const { t } = useTranslation()
  const [pendingDeleteEnum, setPendingDeleteEnum] = useState<DesignEnum | null>(null)

  const confirmDeleteEnum = useCallback((enumId: string): void => {
    const pruned = removeEnumFromDesign(design, enumId)
    assignDesignSection(design, 'enums', design.enums.filter((e) => e.id !== enumId))
    if (pruned.models.some((m, i) => m !== design.models[i])) assignDesignSection(design, 'models', pruned.models)
    if (pruned.routeGroups.some((g, i) => g !== design.routeGroups[i])) assignDesignSection(design, 'routeGroups', pruned.routeGroups)
    if (selectedEnumId === enumId) onSelectEnum?.(null)
    setPendingDeleteEnum(null)
  }, [design, selectedEnumId, onSelectEnum])

  // Run a one-shot action from a sidebar enum node's context menu, once per
  // nonce: add a new enum, or delete one (pruning the references that pointed at
  // it, like the master-details editor's own delete path).
  const lastEnumActionNonce = useRef(0)
  useEffect(() => {
    if (!pendingAction || pendingAction.nonce === lastEnumActionNonce.current) return
    lastEnumActionNonce.current = pendingAction.nonce
    const { action, entityId } = pendingAction
    // Run on a microtask so the selection change (React state) doesn't fire
    // synchronously inside the effect that observed the action.
    queueMicrotask(() => {
      if (action === 'add') {
        const fresh: DesignEnum = {
          id: generateUniqueId(),
          doc: { name: uniqueComponentName(design, t('design.enums.newName', 'NewEnum')), properties: [], enumValues: [] }
        }
        assignDesignSection(design, 'enums', [...design.enums, fresh])
        onSelectEnum?.(fresh.id)
        return
      }
      if (action === 'delete' && entityId !== undefined) {
        // Ask first — deletion prunes every property/param that referenced the
        // enum, so it gets the same yes/no gate as a model or a route group.
        const target = design.enums.find((e) => e.id === entityId)
        if (target !== undefined) setPendingDeleteEnum(target)
      }
    })
  }, [pendingAction, design, t, onSelectEnum])

  // DesignEnum → CustomValueList. Row ids derive from (enum, index):
  // values carry no identity of their own, and the editor's table
  // remounts per list, so positional ids are stable for its lifetime.
  const lists: CustomValueList[] = useMemo(() => design.enums.map((e) => ({
    id: e.id,
    name: e.doc.name,
    // `label` = the member NAME (code identifier, defaults to the value),
    // `value` = the WIRE value. Two columns via `showValue`.
    entries: (e.doc.enumValues ?? []).map((value, index) => ({
      id: `${e.id}:${index}`,
      label: e.memberNames?.[index] !== undefined && e.memberNames[index] !== '' ? e.memberNames[index] : displayValue(value),
      value: displayValue(value),
      enabled: true
    }))
  })), [design.enums])

  // CustomValueList[] → enums. A member exists when it has a non-empty VALUE;
  // its NAME (label) defaults to the value. `bridgeEnumValues` restores the
  // typed originals for the wire values; the names ride alongside in
  // `memberNames` (design-only, index-aligned).
  const onListsChange = useCallback((next: CustomValueList[]) => {
    const byId = new Map(design.enums.map((e) => [e.id, e]))
    const enums: DesignEnum[] = next.map((list) => {
      const existing = byId.get(list.id)
      const members = list.entries.filter((entry) => entry.value.trim() !== '')
      const values = bridgeEnumValues(existing?.doc.enumValues ?? [], members.map((entry) => entry.value))
      const names = members.map((entry) => (entry.label.trim() !== '' ? entry.label : entry.value))
      // Only persist names when at least one differs from its value — a
      // pure value-only enum stays free of the extra field.
      const memberNames = names.some((name, i) => name !== values[i]?.toString()) ? { memberNames: names } : {}
      if (existing !== undefined) {
        const { memberNames: _drop, ...rest } = existing
        return { ...rest, doc: { ...existing.doc, name: list.name, enumValues: values }, ...memberNames }
      }
      return {
        id: list.id,
        doc: {
          name: uniqueComponentName(design, list.name),
          properties: [],
          enumValues: values
        },
        ...memberNames
      }
    })
    assignDesignSection(design, 'enums', enums)
    // A removed enum leaves dangling references — strip them so a property
    // typed by it degrades to its doc type and a route param that referenced
    // it (paramEnumRefs) falls back to its plain type.
    const nextIds = new Set(next.map((l) => l.id))
    const deletedIds = design.enums.filter((e) => !nextIds.has(e.id)).map((e) => e.id)
    if (deletedIds.length > 0) {
      let models = design.models
      let routeGroups = design.routeGroups
      for (const id of deletedIds) {
        const pruned = removeEnumFromDesign({ ...design, models, routeGroups }, id)
        models = pruned.models
        routeGroups = pruned.routeGroups
      }
      if (models.some((m, i) => m !== design.models[i])) assignDesignSection(design, 'models', models)
      if (routeGroups.some((g, i) => g !== design.routeGroups[i])) assignDesignSection(design, 'routeGroups', routeGroups)
    }
  }, [design])

  // Enum-level description: a concern the shared list model doesn't carry, so
  // it rides in the values pane via the editor's `renderSelectedListExtra`
  // slot and writes straight to the selected enum's `doc.description`.
  const setEnumDescription = useCallback((enumId: string, description: string) => {
    const enums = design.enums.map((e) => {
      if (e.id !== enumId) return e
      const trimmed = description.trim()
      if (trimmed === '') {
        const { description: _drop, ...docRest } = e.doc
        return { ...e, doc: docRest }
      }
      return { ...e, doc: { ...e.doc, description } }
    })
    assignDesignSection(design, 'enums', enums)
  }, [design])

  const renderDescription = useCallback((enumId: string): React.ReactNode => {
    const current = design.enums.find((e) => e.id === enumId)?.doc.description ?? ''
    return (
      <>
        <DesignIssuesCallout issues={issues} entityId={enumId} />
        <label className="design-field design-enum-description">
          <span className="design-field-label">{t('design.enums.description', 'Description')}</span>
          <InputBox
            value={current}
            onChange={(value) => { setEnumDescription(enumId, value) }}
            options={{ type: 'text', flexibleHeight: true, ariaLabel: t('design.enums.description', 'Description'), placeholder: t('design.enums.descriptionPlaceholder', 'What this enum represents (optional)') }}
            data-testid="design-enum-description"
          />
        </label>
      </>
    )
  }, [design.enums, setEnumDescription, t, issues])

  return (
    <div className="design-section design-enums-section" data-testid="design-enums-section">
      {selectedEnumId === null ? (
        <DesignEntityListing
          design={design}
          section="enums"
          onSelect={(id) => { onSelectEnum?.(id) }}
          onAction={(designId, section, action, entityId) => {
            // Delete is handled directly (open the confirm) so it doesn't first
            // navigate INTO the enum — the listing is inside this component, like
            // the models section. Add still routes through the intent bus.
            if (action === 'delete' && entityId !== undefined) {
              const target = design.enums.find((e) => e.id === entityId)
              if (target !== undefined) setPendingDeleteEnum(target)
              return
            }
            setPendingDesignSection(designId, section, entityId, action)
          }}
        />
      ) : (
      <CustomValueListsEditor
        lists={lists}
        onListsChange={onListsChange}
        renderSelectedListExtra={renderDescription}
        entriesPersistenceId={`design-enums:${design.id}`}
        wording={{
          listsTitle: t('design.enums.lists', 'Enums'),
          addList: t('design.enums.addEnum', 'Add an enum'),
          valuesTitle: t('design.enums.values', 'Values'),
          addEntry: t('design.enums.addValue', 'Add a value'),
          selectList: t('design.enums.selectPrompt', 'Select an enum, or create one — a closed set of values usable as a property type.'),
          newListName: t('design.enums.newName', 'NewEnum'),
          keyHeader: t('design.enums.nameHeader', 'Name'),
          valueHeader: t('design.enums.valueHeader', 'Value'),
          filterPlaceholder: t('design.list.filter', 'Filter…')
        }}
        showEnabledToggle={false}
        showValue
        hideListsPanel
        selectedListId={selectedEnumId}
        {...(onSelectEnum ? { onSelectList: onSelectEnum } : {})}
        testIdPrefix="design-enums"
      />
      )}

      {pendingDeleteEnum !== null && (
        <Modal
          title={t('design.enums.deleteTitle', 'Delete {{name}}?', { name: pendingDeleteEnum.doc.name === '' ? t('design.schema.unnamed', '(unnamed)') : pendingDeleteEnum.doc.name })}
          isOpen
          onClose={() => { setPendingDeleteEnum(null) }}
          size="dialog"
          data-testid="design-enum-delete-modal"
          enterActionTestId="design-enum-delete-confirm"
        >
          <div className="design-delete-modal-body">
            <p>{t('design.enums.deleteImpact', 'Any property or parameter that used this enum will lose its reference.')}</p>
            <div className="design-delete-modal-actions">
              <Button secondary onClick={() => { setPendingDeleteEnum(null) }} data-testid="design-enum-delete-cancel">
                {t('sidebar.deleteConfirm.cancel')}
              </Button>
              <Button onClick={() => { confirmDeleteEnum(pendingDeleteEnum.id) }} data-testid="design-enum-delete-confirm">
                {t('sidebar.deleteConfirm.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
