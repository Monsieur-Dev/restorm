import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiDesign, DesignEnum, CustomValueList } from '../../../../shared/types/collections'
import { CustomValueListsEditor } from '../Folders/CustomValueListsEditor'
import { assignDesignSection, uniqueComponentName } from './designMutations'
import { displayValue } from './designDisplay'

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
    entries: (e.doc.enumValues ?? []).map((value, index) => ({
      id: `${e.id}:${index}`,
      label: displayValue(value),
      value: displayValue(value),
      enabled: true
    }))
  })), [design.enums])

  // CustomValueList[] → enums. A row's text comes back in `label` (the
  // value column is hidden). An untouched row keeps its ORIGINAL value
  // (numeric enum members survive the string round-trip); an edited or
  // new row stores the typed string.
  const onListsChange = useCallback((next: CustomValueList[]) => {
    const byId = new Map(design.enums.map((e) => [e.id, e]))
    const enums: DesignEnum[] = next.map((list) => {
      const existing = byId.get(list.id)
      const previousValues = existing?.doc.enumValues ?? []
      const values = list.entries
        .filter((entry) => entry.label.trim() !== '')
        .map((entry, index) => {
          const previous = previousValues[index]
          return previous !== undefined && displayValue(previous) === entry.label ? previous : entry.label
        })
      if (existing !== undefined) {
        return { ...existing, doc: { ...existing.doc, name: list.name, enumValues: values } }
      }
      return {
        id: list.id,
        doc: {
          name: uniqueComponentName(design, list.name),
          properties: [],
          enumValues: values
        }
      }
    })
    assignDesignSection(design, 'enums', enums)
  }, [design])

  return (
    <div className="design-section design-enums-section" data-testid="design-enums-section">
      <CustomValueListsEditor
        lists={lists}
        onListsChange={onListsChange}
        entriesPersistenceId={`design-enums:${design.id}`}
        wording={{
          listsTitle: t('design.enums.lists', 'Enums'),
          addList: t('design.enums.addEnum', 'Add an enum'),
          valuesTitle: t('design.enums.values', 'Values'),
          addEntry: t('design.enums.addValue', 'Add a value'),
          selectList: t('design.enums.selectPrompt', 'Select an enum, or create one — a closed set of values usable as a property type.'),
          newListName: t('design.enums.newName', 'NewEnum'),
          keyHeader: t('design.enums.valueHeader', 'Value')
        }}
        showEnabledToggle={false}
        showValue={false}
        testIdPrefix="design-enums"
      />
    </div>
  )
}
