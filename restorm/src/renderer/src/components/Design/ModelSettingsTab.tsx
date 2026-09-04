import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, SelectBox, Toggle, type ISelectData } from 'electron-core-ui/renderer'
import type { ApiDesign, DesignModel, IdentifierStrategy, ModelDesignMeta, ModelIntents, ModelVolumetry, ModelAccessPattern, ModelTraffic, ModelFreshness, ModelSensitivity, ModelRetention } from '../../../../shared/types/collections'
import { collectModelUsages, type DesignModelUsage } from '../../../../shared/design/designUsages'
import { generateSearchParams } from '../../../../shared/design/designRoutes'
import { generateUniqueId } from '../../utils/treeManipulation'
import { assignDesignSection, replaceModel } from './designMutations'

const STRATEGIES: readonly IdentifierStrategy[] = ['uuid', 'autoIncrement', 'ulid']
const VOLUMETRIES: readonly (ModelVolumetry | '')[] = ['', 'hundreds', 'tenThousands', 'millions']
const ACCESS_PATTERNS: readonly (ModelAccessPattern | '')[] = ['', 'readHeavy', 'writeHeavy', 'balanced', 'appendOnly']
const TRAFFICS: readonly (ModelTraffic | '')[] = ['', 'low', 'medium', 'high']
const FRESHNESSES: readonly (ModelFreshness | '')[] = ['', 'strong', 'shortCache', 'longCache']
const SENSITIVITIES: readonly (ModelSensitivity | '')[] = ['', 'public', 'internal', 'confidential', 'pii']
const RETENTIONS: readonly (ModelRetention | '')[] = ['', 'permanent', 'archivable', 'ephemeral']

export interface ModelSettingsTabProps {
  design: ApiDesign
  model: DesignModel
  onJumpTo: (section: 'models' | 'routes', entityId: string) => void
  /** Open the CRUD-generation modal (replace existing? protect writes?)
   * owned by the parent Models section, so both entry points share it. */
  onGenerateCrud: (model: DesignModel) => void
}

/**
 * The Settings tab of a model card: identity (identifier property +
 * strategy), volumetry intent, lifecycle facts (timestamps, soft
 * delete), inheritance (cycle-safe choices only) and the "Used by"
 * jump list.
 */
export const ModelSettingsTab: React.FC<ModelSettingsTabProps> = ({ design, model, onJumpTo, onGenerateCrud }) => {
  const { t } = useTranslation()

  const setMeta = (patch: { [K in keyof ModelDesignMeta]?: ModelDesignMeta[K] | undefined }): void => {
    const merged = { ...(model.design ?? {}), ...patch }
    const cleaned: ModelDesignMeta = {}
    if (merged.identifier !== undefined) cleaned.identifier = merged.identifier
    if (merged.timestamps !== undefined) cleaned.timestamps = merged.timestamps
    if (merged.softDelete !== undefined) cleaned.softDelete = merged.softDelete
    if (merged.inheritsFrom !== undefined) cleaned.inheritsFrom = merged.inheritsFrom
    const { design: _meta, ...modelRest } = model
    replaceModel(design, model.id, Object.keys(cleaned).length > 0 ? { ...modelRest, design: cleaned } : modelRest)
  }

  // Set one operational-profile intent (undefined clears it). Drops the whole
  // `intents` object when the last field is cleared, so an untouched model
  // stays intent-free.
  const setIntentField = (field: keyof ModelIntents, value: string | undefined): void => {
    const merged: Record<string, string | undefined> = { ...(model.intents ?? {}), [field]: value }
    const cleaned: ModelIntents = {}
    if (merged['volumetry']) cleaned.volumetry = merged['volumetry'] as ModelVolumetry
    if (merged['accessPattern']) cleaned.accessPattern = merged['accessPattern'] as ModelAccessPattern
    if (merged['traffic']) cleaned.traffic = merged['traffic'] as ModelTraffic
    if (merged['freshness']) cleaned.freshness = merged['freshness'] as ModelFreshness
    if (merged['sensitivity']) cleaned.sensitivity = merged['sensitivity'] as ModelSensitivity
    if (merged['retention']) cleaned.retention = merged['retention'] as ModelRetention
    const { intents: _intents, ...modelRest } = model
    replaceModel(design, model.id, Object.keys(cleaned).length > 0 ? { ...modelRest, intents: cleaned } : modelRest)
  }

  // One SelectBox for an operational-profile intent: an "(unspecified)" first
  // entry plus each value, labelled from `design.<optPrefix>.<value>`.
  const profileUnset = t('design.modelSettings.profileUnset', '(unspecified)')
  const intentSelect = (
    field: keyof ModelIntents,
    labelKey: string,
    labelDefault: string,
    values: readonly string[],
    optPrefix: string,
    testid: string
  ): React.ReactNode => {
    const label = t(labelKey, labelDefault)
    const optLabel = (v: string): string => (v === '' ? profileUnset : t(`design.${optPrefix}.${v}`, v))
    const current = (model.intents?.[field] as string | undefined) ?? ''
    return (
      <label className="design-field">
        <span className="design-field-label">{label}</span>
        <SelectBox
          id={`design-model-${testid}-${model.id}`}
          className=""
          options={values.map((v) => ({ text: optLabel(v) }))}
          selected={Math.max(0, values.indexOf(current))}
          onDidSelect={(data: ISelectData) => {
            const picked = values.find((v) => optLabel(v) === data.selected) ?? ''
            setIntentField(field, picked === '' ? undefined : picked)
          }}
          selectBoxOptions={{ ariaLabel: label, useCustomDrawn: true }}
          data-testid={`design-model-${testid}`}
        />
      </label>
    )
  }

  // ── Identifier ─────────────────────────────────────────────────────
  const identifierOptions = [
    { text: t('design.modelSettings.noIdentifier', '(none)') },
    ...model.properties.map((p) => ({ text: p.doc.name === '' ? t('design.schema.unnamed', '(unnamed)') : p.doc.name }))
  ]
  const identifierIndex = model.design?.identifier === undefined
    ? 0
    : Math.max(0, model.properties.findIndex((p) => p.id === model.design?.identifier?.propertyId) + 1)

  // ── Inheritance: only models that would NOT create a cycle ─────────
  const inheritanceCandidates = useMemo(() => {
    const descendants = new Set<string>([model.id])
    let grew = true
    while (grew) {
      grew = false
      for (const m of design.models) {
        const parent = m.design?.inheritsFrom
        if (parent !== undefined && descendants.has(parent) && !descendants.has(m.id)) {
          descendants.add(m.id)
          grew = true
        }
      }
    }
    return design.models.filter((m) => !descendants.has(m.id))
  }, [design.models, model.id])

  const inheritOptions = [
    { text: t('design.modelSettings.noParent', '(none)') },
    ...inheritanceCandidates.map((m) => ({ text: m.doc.name }))
  ]
  const inheritIndex = model.design?.inheritsFrom === undefined
    ? 0
    : Math.max(0, inheritanceCandidates.findIndex((m) => m.id === model.design?.inheritsFrom) + 1)

  // ── Usages ─────────────────────────────────────────────────────────
  const usages = useMemo(() => collectModelUsages(design, model.id), [design, model.id])

  const usageText = (usage: DesignModelUsage): string => {
    switch (usage.kind) {
      case 'routeBody':
        return `${usage.label} · ${t('design.modelSettings.usage.body', 'body')}`
      case 'routeResponse':
        return `${usage.label} · ${t('design.modelSettings.usage.response', 'response {{code}}', { code: usage.detail ?? '' })}`
      case 'routeParam':
        return `${usage.label} · ${t('design.modelSettings.usage.param', 'param {{name}}', { name: usage.detail ?? '' })}`
      case 'modelProperty':
        return usage.label
      case 'modelInheritance':
        return t('design.modelSettings.usage.inherits', '{{name}} inherits from it', { name: usage.label })
    }
  }

  return (
    <div className="design-model-settings" data-testid={`design-model-settings-${model.id}`}>
      <h3 className="design-settings-group-title">{t('design.modelSettings.identity', 'Identity')}</h3>
      <div className="design-settings-grid">
        <label className="design-field">
          <span className="design-field-label">{t('design.modelSettings.identifierProperty', 'Identifier property')}</span>
          <SelectBox
            id={`design-model-identifier-${model.id}`}
            className=""
            options={identifierOptions}
            selected={identifierIndex}
            onDidSelect={(data: ISelectData) => {
              // By INDEX, not by label: unnamed properties all render the
              // same "(unnamed)" text.
              const index = data.index
              if (index <= 0) {
                setMeta({ identifier: undefined })
                return
              }
              const property = model.properties[index - 1]
              if (property === undefined) return
              setMeta({ identifier: { propertyId: property.id, strategy: model.design?.identifier?.strategy ?? 'uuid' } })
            }}
            selectBoxOptions={{ ariaLabel: t('design.modelSettings.identifierProperty', 'Identifier property'), useCustomDrawn: true }}
            data-testid="design-model-identifier-property"
          />
        </label>
        {model.design?.identifier !== undefined && (
          <label className="design-field">
            <span className="design-field-label">{t('design.modelSettings.identifierStrategy', 'Strategy')}</span>
            <SelectBox
              id={`design-model-strategy-${model.id}`}
              className=""
              options={STRATEGIES.map((s) => ({ text: t(`design.identifierStrategy.${s}`, s) }))}
              selected={Math.max(0, STRATEGIES.indexOf(model.design.identifier.strategy))}
              onDidSelect={(data: ISelectData) => {
                const picked = STRATEGIES.find((s) => t(`design.identifierStrategy.${s}`, s) === data.selected) ?? 'uuid'
                const identifier = model.design?.identifier
                if (identifier === undefined) return
                setMeta({ identifier: { ...identifier, strategy: picked } })
              }}
              selectBoxOptions={{ ariaLabel: t('design.modelSettings.identifierStrategy', 'Strategy'), useCustomDrawn: true }}
              data-testid="design-model-identifier-strategy"
            />
          </label>
        )}
        <label className="design-field">
          <span className="design-field-label">{t('design.modelSettings.inheritsFrom', 'Inherits from')}</span>
          <SelectBox
            id={`design-model-inherits-${model.id}`}
            className=""
            options={inheritOptions}
            selected={inheritIndex}
            onDidSelect={(data: ISelectData) => {
              // By INDEX: two homonymous models are a reported-but-legal state.
              const index = data.index
              if (index <= 0) {
                setMeta({ inheritsFrom: undefined })
                return
              }
              const parent = inheritanceCandidates[index - 1]
              if (parent !== undefined) setMeta({ inheritsFrom: parent.id })
            }}
            selectBoxOptions={{ ariaLabel: t('design.modelSettings.inheritsFrom', 'Inherits from'), useCustomDrawn: true }}
            data-testid="design-model-inherits"
          />
        </label>
      </div>

      <h3 className="design-settings-group-title">{t('design.modelSettings.operationalProfile', 'Operational profile')}</h3>
      <div className="design-settings-grid">
        {intentSelect('volumetry', 'design.modelSettings.volumetry', 'Expected volume', VOLUMETRIES, 'volumetry', 'volumetry')}
        {intentSelect('accessPattern', 'design.modelSettings.accessPattern', 'Read/write profile', ACCESS_PATTERNS, 'accessPattern', 'access-pattern')}
        {intentSelect('traffic', 'design.modelSettings.traffic', 'Access frequency', TRAFFICS, 'traffic', 'traffic')}
        {intentSelect('freshness', 'design.modelSettings.freshness', 'Freshness tolerance', FRESHNESSES, 'freshness', 'freshness')}
        {intentSelect('sensitivity', 'design.modelSettings.sensitivity', 'Data sensitivity', SENSITIVITIES, 'sensitivity', 'sensitivity')}
        {intentSelect('retention', 'design.modelSettings.retention', 'Retention / lifecycle', RETENTIONS, 'retention', 'retention')}
      </div>

      <h3 className="design-settings-group-title">{t('design.modelSettings.storage', 'Storage & lifecycle')}</h3>
      <div className="design-settings-grid">
        <label className="design-flag-toggle">
          <span className="design-field-label">{t('design.modelSettings.timestamps', 'Timestamps')}</span>
          <Toggle
            checked={model.design?.timestamps === true}
            onChange={(checked) => { setMeta({ timestamps: checked ? true : undefined }) }}
            aria-label={t('design.modelSettings.timestamps', 'Timestamps')}
            data-testid="design-model-timestamps"
          />
        </label>
        <label className="design-flag-toggle">
          <span className="design-field-label">{t('design.modelSettings.softDelete', 'Soft delete')}</span>
          <Toggle
            checked={model.design?.softDelete === true}
            onChange={(checked) => { setMeta({ softDelete: checked ? true : undefined }) }}
            aria-label={t('design.modelSettings.softDelete', 'Soft delete')}
            data-testid="design-model-soft-delete"
          />
        </label>
      </div>

      <h3 className="design-settings-group-title">{t('design.modelSettings.generators', 'Routes')}</h3>
      <div className="design-generator-actions">
        <Button
          secondary
          onClick={() => { onGenerateCrud(model) }}
          data-testid="design-model-generate-crud"
        >
          {t('design.modelSettings.generateCrud', 'Generate the CRUD')}
        </Button>
        {model.properties.some((p) => p.design?.searchable === true) && (
          <Button
            secondary
            onClick={() => {
              const { routeGroups, changed } = generateSearchParams(design, model, generateUniqueId)
              if (!changed) return
              assignDesignSection(design, 'routeGroups', routeGroups)
              const target = routeGroups.find((g) => g.routes.some((r) =>
                Object.values(r.design?.responses ?? {}).some((resp) => resp.modelId === model.id && resp.list === true)))
              if (target !== undefined) onJumpTo('routes', target.id)
            }}
            data-testid="design-model-generate-search"
          >
            {t('design.modelSettings.generateSearch', 'Generate the search routes')}
          </Button>
        )}
      </div>

      <h3 className="design-settings-group-title">{t('design.modelSettings.usedBy', 'Used by')}</h3>
      {usages.length === 0
        ? <p className="design-section-placeholder-message">{t('design.modelSettings.usedByNone', 'This model is not used yet.')}</p>
        : (
          <div className="design-usage-chips" data-testid="design-model-usages">
            {usages.map((usage, index) => (
              <button
                key={`${usage.kind}-${usage.entityId}-${index}`}
                type="button"
                className="design-usage-chip"
                onClick={() => { onJumpTo(usage.section, usage.entityId) }}
                data-testid={`design-model-usage-${index}`}
              >
                <span className={`codicon codicon-${usage.section === 'routes' ? 'arrow-swap' : 'symbol-class'}`} />
                {usageText(usage)}
              </button>
            ))}
          </div>
        )}
    </div>
  )
}
