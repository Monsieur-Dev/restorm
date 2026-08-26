import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox } from 'electron-core-ui/renderer'
import type { ApiDesign, DesignEnum, CustomValueList } from '../../../../shared/types/collections'
import { CustomValueListsEditor } from '../Folders/CustomValueListsEditor'
import { assignDesignSection, uniqueComponentName } from './designMutations'
import { bridgeEnumValues, displayValue } from './designDisplay'

/**
 * The Enums section of the Design tab: the SAME master-details editor
 * as the env folder's custom value lists, bridged onto the design's
 * enums. The bridge is the settled answer to the shared-model question:
 * `doc.enumValues` stays the only stored truth (importer/exporter
 * compatible), and each render maps it to the editor's list shape —
 * single column (no label/value split, no enable toggle), the row text
 * IS the enum value.
 */
export const DesignEnumsSection: React.FC<{ design: ApiDesign }> = ({ design }) => {
  const { t } = useTranslation()

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
      <label className="design-field design-enum-description">
        <span className="design-field-label">{t('design.enums.description', 'Description')}</span>
        <InputBox
          value={current}
          onChange={(value) => { setEnumDescription(enumId, value) }}
          options={{ type: 'text', flexibleHeight: true, ariaLabel: t('design.enums.description', 'Description'), placeholder: t('design.enums.descriptionPlaceholder', 'What this enum represents (optional)') }}
          data-testid="design-enum-description"
        />
      </label>
    )
  }, [design.enums, setEnumDescription, t])

  return (
    <div className="design-section design-enums-section" data-testid="design-enums-section">
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
        filterable
        reorderableLists
        testIdPrefix="design-enums"
      />
    </div>
  )
}
