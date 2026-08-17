import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  InputBox,
  ListView,
  MarkdownEditor,
  ScrollableElement,
  SelectBox,
  eventBus,
  type ISelectData,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { ApiDesign, DesignAuthKind } from '../../../../shared/types/collections'
import type { DesignSectionKey } from '../../../../shared/types/editor'
import { DESIGN_SECTIONS } from '../../../../shared/design/designSections'
import { validateApiDesign } from '../../../../shared/design/validateApiDesign'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { consumePendingDesignSection, peekPendingDesignSection, subscribeDesignSectionIntent } from '../../services/designSectionIntent'
import { assignDesignSection } from './designMutations'
import { DesignModelsSection } from './DesignModelsSection'
import { DesignEnumsSection } from './DesignEnumsSection'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './designTabView.css'

export interface DesignTabViewProps {
  design: ApiDesign
  /** The workbench tab hosting this view (test ids derive from it). */
  tabId: string
}

/**
 * The Design tab: an icon rail on the left switching between the
 * design's sections, one section pane on the right. ONE tab per design
 * (single-tab policy) — the sidebar's group entries refocus this same
 * tab through the design-section intent channel.
 *
 * Edits write straight onto the REACTIVE design by reassigning a
 * top-level section (the 468-family mutation convention): the proxy
 * emits `DESIGN_UPDATED` into the standard dirty / autosave pipeline.
 * Editing is free on every plan (Yoann, 2026-08-17) — what the plan
 * gates is RUNNING the design (serve, codegen), via
 * `DESIGN_RUN_CAPABILITY` on those buttons when they land.
 */
export const DesignTabView: React.FC<DesignTabViewProps> = ({ design, tabId }) => {
  const { t } = useTranslation()
  // PEEK only in the initializers: StrictMode double-invokes them in dev
  // builds, so a consuming read would drain the map on the throwaway
  // call. The mount effect below does the consuming.
  const [activeSection, setActiveSection] = useState<DesignSectionKey>(
    () => peekPendingDesignSection(design.id)?.section ?? 'settings'
  )
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    const intent = peekPendingDesignSection(design.id)
    return intent?.section === 'models' ? intent.entityId ?? null : null
  })

  // Follow section intents while mounted — the single-tab policy means
  // a sidebar group click usually refocuses this already-open tab. The
  // live subscriber ALSO consumes the staged entry: without that, an
  // intent applied to an already-mounted tab would linger in the map
  // and replay on the next open. A pending intent staged between the
  // initializer and this subscription is drained on a microtask (never
  // a synchronous state write in the effect body).
  useEffect(() => {
    const applyIntent = (intent: { section: DesignSectionKey; entityId?: string }): void => {
      setActiveSection(intent.section)
      if (intent.section === 'models' && intent.entityId !== undefined) setSelectedModelId(intent.entityId)
    }
    const unsubscribe = subscribeDesignSectionIntent((designId, intent) => {
      if (designId !== design.id) return
      consumePendingDesignSection(design.id)
      applyIntent(intent)
    })
    const pending = consumePendingDesignSection(design.id)
    if (pending !== undefined) {
      queueMicrotask(() => { applyIntent(pending) })
    }
    return unsubscribe
  }, [design.id])

  // Structural edits (add a property, delete a model…) mutate the
  // reactive design in place — this tab re-renders off the proxy's own
  // DESIGN_UPDATED event, scoped to this design, without waiting for
  // any app-level refresh.
  const [, setDesignTick] = useState(0)
  useEffect(() => {
    const subscription = eventBus.subscribe(DocumentEvents.DESIGN_UPDATED, (payload) => {
      if ((payload as DocumentChangedPayload).id === design.id) setDesignTick((n) => n + 1)
    })
    return () => { subscription.unsubscribe() }
  }, [design.id])

  // Fresh on every render (renders are driven by the tick above): the
  // issues feed row-level errors, the sidebar dots and — later — the
  // design server / codegen gates.
  const issues = validateApiDesign(design)

  const jumpTo = (section: 'models' | 'routes', entityId: string): void => {
    setActiveSection(section)
    if (section === 'models') setSelectedModelId(entityId)
  }

  return (
    <div className="design-tab-view" data-testid={`design-tab-view-${design.id}`}>
      <nav className="design-rail" aria-label={t('design.rail.ariaLabel', 'Design sections')}>
        {DESIGN_SECTIONS.map((section) => (
          <HeaderHoverTooltip key={section.key} label={t(section.labelKey)}>
            <button
              type="button"
              className={`design-rail-button${activeSection === section.key ? ' active' : ''}`}
              aria-label={t(section.labelKey)}
              aria-pressed={activeSection === section.key}
              data-testid={`design-rail-${section.key}`}
              onClick={() => { setActiveSection(section.key) }}
            >
              <span className={`codicon codicon-${section.codicon}`} />
            </button>
          </HeaderHoverTooltip>
        ))}
      </nav>
      <div className="design-section-host" data-testid={`design-section-${activeSection}`}>
        {activeSection === 'settings' && (
          <DesignSettingsSection design={design} />
        )}
        {activeSection === 'models' && (
          <DesignModelsSection
            design={design}
            issues={issues}
            selectedModelId={selectedModelId}
            onSelectModel={setSelectedModelId}
            onJumpTo={jumpTo}
          />
        )}
        {activeSection === 'enums' && (
          <DesignEnumsSection design={design} />
        )}
        {activeSection === 'routes' && (
          <DesignEntityListSection key={activeSection} design={design} section={activeSection} />
        )}
        {activeSection === 'documentation' && (
          <DesignSectionPlaceholder
            title={t('design.section.documentation')}
            message={t('design.documentation.empty', 'The design documentation will be served here.')}
          />
        )}
        {activeSection === 'notes' && (
          <DesignNotesSection design={design} tabId={tabId} />
        )}
        {activeSection === 'code' && (
          <DesignSectionPlaceholder
            title={t('design.section.code')}
            message={t('design.code.empty', 'Code generation from this design will live here.')}
          />
        )}
      </div>
    </div>
  )
}

const DesignSectionPlaceholder: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className="design-section design-section-placeholder">
    <h2 className="design-section-title">{title}</h2>
    <p className="design-section-placeholder-message">{message}</p>
  </div>
)

/**
 * Settings — design-server block on top (spin arrives with the design
 * server), then the API identity. Every edit reassigns a top-level
 * design key so the reactive proxy sees it.
 */
const AUTH_KINDS: readonly DesignAuthKind[] = ['none', 'bearer', 'apiKeyHeader', 'basic']

const DesignSettingsSection: React.FC<{ design: ApiDesign }> = ({ design }) => {
  const { t } = useTranslation()
  const authOptions = useMemo(() => [
    { text: t('design.auth.none', 'None') },
    { text: t('design.auth.bearer', 'Bearer (JWT)') },
    { text: t('design.auth.apiKeyHeader', 'API key header') },
    { text: t('design.auth.basic', 'Basic') }
  ], [t])

  const patchInfo = useCallback((patch: Partial<ApiDesign['info']>) => {
    assignDesignSection(design, 'info', { ...design.info, ...patch })
  }, [design])

  const patchVersion = useCallback((value: string) => {
    const { version: _dropped, ...rest } = design.info
    assignDesignSection(design, 'info', value === '' ? rest : { ...rest, version: value })
  }, [design])

  const patchDescription = useCallback((value: string) => {
    const { description: _dropped, ...rest } = design.info
    assignDesignSection(design, 'info', value === '' ? rest : { ...rest, description: value })
  }, [design])

  const patchServer = useCallback((basePath: string) => {
    const next = { ...(design.server ?? {}) }
    if (basePath === '') {
      delete next.basePath
    } else {
      next.basePath = basePath
    }
    assignDesignSection(design, 'server', next)
  }, [design])

  const setDefaultAuth = useCallback((auth: DesignAuthKind) => {
    assignDesignSection(design, 'defaultAuth', auth)
  }, [design])

  const protocols = design.serving?.protocols ?? ['http']

  return (
    <ScrollableElement className="design-section-scroll">
      <div className="design-section design-settings" data-testid="design-settings-section">
        <h2 className="design-section-title">{t('design.section.settings')}</h2>
        <p className="design-section-subtitle">
          {t('design.settings.subtitle', 'General settings of the design “{{name}}”', { name: design.name })}
        </p>

        <h3 className="design-settings-group-title">{t('design.settings.serve.title', 'Design server')}</h3>
        <div className="design-serve-block" data-testid="design-serve-block">
          <div className="design-serve-text">
            <span className="design-serve-title">{t('design.settings.serve.action', 'Serve this design')}</span>
            <span className="design-serve-description">
              {t('design.settings.serve.description', 'Responses from named examples · validation by constraints')}
            </span>
          </div>
          <div className="design-serve-protocols">
            {(['http', 'graphql', 'soap', 'odata'] as const).map((protocol) => (
              <span
                key={protocol}
                className={`design-protocol-pill${protocols.includes(protocol) ? ' active' : ''}`}
                data-testid={`design-protocol-${protocol}`}
              >
                {t(`design.protocol.${protocol}`)}
              </span>
            ))}
          </div>
          <HeaderHoverTooltip label={t('design.settings.serve.comingSoon', 'The design server is coming soon')}>
            <button
              type="button"
              className="design-serve-spin"
              aria-label={t('design.settings.serve.action', 'Serve this design')}
              disabled
              data-testid="design-serve-spin"
            >
              <span className="codicon codicon-play" />
            </button>
          </HeaderHoverTooltip>
        </div>

        <h3 className="design-settings-group-title">{t('design.settings.identity.title', 'Identity')}</h3>
          <div className="design-settings-grid">
            <label className="design-field design-field-wide">
              <span className="design-field-label">{t('design.settings.identity.title_field', 'Title')}</span>
              <InputBox
                value={design.info.title}
                onChange={(value) => { patchInfo({ title: value }) }}
                options={{ type: 'text', ariaLabel: t('design.settings.identity.title_field', 'Title') }}
                data-testid="design-settings-title"
              />
            </label>
            <label className="design-field">
              <span className="design-field-label">{t('design.settings.identity.version', 'Design version')}</span>
              <InputBox
                value={design.info.version ?? ''}
                onChange={(value) => { patchVersion(value) }}
                options={{ type: 'text', ariaLabel: t('design.settings.identity.version', 'Design version') }}
                data-testid="design-settings-version"
              />
            </label>
            <label className="design-field design-field-full">
              <span className="design-field-label">{t('design.settings.identity.description', 'Description')}</span>
              <InputBox
                value={design.info.description ?? ''}
                onChange={(value) => { patchDescription(value) }}
                options={{ type: 'text', flexibleHeight: true, ariaLabel: t('design.settings.identity.description', 'Description') }}
                data-testid="design-settings-description"
              />
            </label>
          </div>

          <h3 className="design-settings-group-title">{t('design.settings.api.title', 'API')}</h3>
          <div className="design-settings-grid">
            <label className="design-field">
              <span className="design-field-label">{t('design.settings.api.basePath', 'Base path')}</span>
              <InputBox
                value={design.server?.basePath ?? ''}
                onChange={patchServer}
                options={{ type: 'text', placeholder: '/api/v1', ariaLabel: t('design.settings.api.basePath', 'Base path') }}
                data-testid="design-settings-base-path"
              />
            </label>
            <label className="design-field">
              <span className="design-field-label">{t('design.settings.api.defaultAuth', 'Default auth')}</span>
              <SelectBox
                id="design-default-auth-select"
                className=""
                options={authOptions}
                selected={Math.max(0, AUTH_KINDS.indexOf(design.defaultAuth ?? 'none'))}
                onDidSelect={(data: ISelectData) => {
                  const picked = authOptions.findIndex((opt) => opt.text === data.selected)
                  setDefaultAuth(AUTH_KINDS[picked] ?? 'none')
                }}
                selectBoxOptions={{ ariaLabel: t('design.settings.api.defaultAuth', 'Default auth'), useCustomDrawn: true }}
                data-testid="design-settings-default-auth"
              />
            </label>
          </div>
      </div>
    </ScrollableElement>
  )
}

/**
 * The list-driven sections (models / enums / routes): a filterable
 * master list; the per-entity editors arrive with their own sections'
 * tickets, so the detail pane states that plainly for now.
 */
const DesignEntityListSection: React.FC<{ design: ApiDesign; section: 'models' | 'enums' | 'routes' }> = ({ design, section }) => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const spec = DESIGN_SECTIONS.find((s) => s.key === section)
  const entries = useMemo(() => {
    if (section === 'models') {
      return design.models.map((m) => ({
        id: m.id,
        name: m.doc.name,
        detail: t('design.models.propertyCount', '{{count}} props', { count: m.properties.length })
      }))
    }
    if (section === 'enums') {
      return design.enums.map((e) => ({
        id: e.id,
        name: e.doc.name,
        detail: t('design.enums.valueCount', '{{count}} values', { count: e.doc.enumValues?.length ?? 0 })
      }))
    }
    return design.routeGroups.flatMap((group) => group.routes.map((route) => ({
      id: route.id,
      name: `${route.doc.match.method ?? ''} ${group.design?.basePath ?? ''}${route.doc.match.urlPattern}`.trim(),
      detail: group.doc.name
    })))
  }, [design, section, t])

  const rows: ListViewItemData[] = useMemo(() =>
    entries
      .filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()))
      .map((entry) => ({
        id: entry.id,
        title: entry.name,
        rightActions: <span className="design-list-detail">{entry.detail}</span>
      })), [entries, filter])

  return (
    <div className="design-section design-entity-list-section">
      <div className="design-entity-list" data-testid={`design-${section}-list`}>
        <div className="design-entity-list-header">
          <h2 className="design-section-title">{spec ? t(spec.labelKey) : section}</h2>
        </div>
        <InputBox
          value={filter}
          onChange={setFilter}
          options={{ type: 'text', placeholder: t('design.list.filter', 'Filter…'), ariaLabel: t('design.list.filter', 'Filter…') }}
          data-testid={`design-${section}-filter`}
        />
        <ScrollableElement className="design-entity-list-scroll">
          <ListView
            items={rows}
            selectedIds={selectedId === null ? [] : [selectedId]}
            onItemClick={(payload) => { setSelectedId(payload.item.id) }}
            disableDrag
            data-testid={`design-${section}-listview`}
          />
        </ScrollableElement>
      </div>
      <div className="design-entity-detail" data-testid={`design-${section}-detail`}>
        <p className="design-section-placeholder-message">
          {selectedId === null
            ? t('design.list.selectPrompt', 'Select an entry in the list.')
            : t('design.list.editorPending', 'The editor for this section is on its way.')}
        </p>
      </div>
    </div>
  )
}

/** Notes — the same markdown surface requests and folders have. */
const DesignNotesSection: React.FC<{ design: ApiDesign; tabId: string }> = ({ design, tabId }) => {
  const { t } = useTranslation()
  return (
    <div className="design-section design-notes-section">
      <h2 className="design-section-title">{t('design.section.notes')}</h2>
      <MarkdownEditor
        key={`${tabId}-notes`}
        initialValue={design.notes ?? ''}
        onChange={(md: string) => { assignDesignSection(design, 'notes', md) }}
        data-testid="design-notes-editor"
      />
    </div>
  )
}
