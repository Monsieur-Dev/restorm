import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  GatedControl,
  IconView,
  InputBox,
  MarkdownEditor,
  ScrollableElement,
  SelectBox,
  eventBus,
  useAuthState,
  usePersistedState,
  type ISelectData
} from 'electron-core-ui/renderer'
import type { ApiDesign, DesignAuthKind } from '../../../../shared/types/collections'
import type { DesignSectionKey } from '../../../../shared/types/editor'
import { DESIGN_SECTIONS } from '../../../../shared/design/designSections'
import { validateApiDesign } from '../../../../shared/design/validateApiDesign'
import { isDesignRunLocked } from '../../../../shared/auth/planCapabilities'
import { subscribeToPro } from '../../services/subscribeToPro'
import { isDesignServerListening } from '../../services/designServerStore'
import { DESCRIPTOR_FORMATS, descriptorFileName } from '../../../../shared/design/descriptorFormats'
import { DesignServerSection } from './DesignServerSection'
import { resolveServedDesign, servedEnvVars } from './designServeResolve'
import { resolveUrlAgainstEnv } from '../../../../shared/utils/resolveUrlAgainstEnv'
import { DesignCodeSection } from './DesignCodeSection'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { consumePendingDesignSection, peekPendingDesignSection, subscribeDesignSectionIntent } from '../../services/designSectionIntent'
import { useRestormStore } from '../../store/restormStore'
import { assignDesignSection } from './designMutations'
import { DesignModelsSection } from './DesignModelsSection'
import { DesignEnumsSection } from './DesignEnumsSection'
import { DesignRoutesSection } from './DesignRoutesSection'
import { DesignDocumentationSection } from './DesignDocumentationSection'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useDesignEnvVariables } from '../../hooks/useDesignEnvVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
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
  // Persisted per design (user setting, NOT the .restorm file): the last section
  // is restored across tab switches AND file reopen. A pending navigation intent
  // still wins via the mount effect below.
  const [activeSection, setActiveSection] = usePersistedState<DesignSectionKey>(
    `design-active-section:${design.id}`,
    peekPendingDesignSection(design.id)?.section ?? 'settings'
  )
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    const intent = peekPendingDesignSection(design.id)
    return intent?.section === 'models' ? intent.entityId ?? null : null
  })
  const [selectedRouteEntityId, setSelectedRouteEntityId] = useState<string | null>(() => {
    const intent = peekPendingDesignSection(design.id)
    return intent?.section === 'routes' ? intent.entityId ?? null : null
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
      if (intent.section === 'routes' && intent.entityId !== undefined) setSelectedRouteEntityId(intent.entityId)
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
  }, [design.id, setActiveSection])

  // Structural edits (add a property, delete a model…) mutate the
  // reactive design in place — this tab re-renders off the proxy's own
  // DESIGN_UPDATED event, scoped to this design, without waiting for
  // any app-level refresh.
  const [designTick, setDesignTick] = useState(0)
  useEffect(() => {
    const subscription = eventBus.subscribe(DocumentEvents.DESIGN_UPDATED, (payload) => {
      if ((payload as DocumentChangedPayload).id !== design.id) return
      setDesignTick((n) => n + 1)
      // Serving? Push the fresh shape to the running server so edits
      // take effect on the next request — the AC#10 hot loop. The
      // JSON round-trip strips the reactive proxy (the contextBridge
      // rejects proxied objects).
      if (isDesignServerListening(design.id)) {
        // Resolve the serve-config variables against the owning folder's
        // first environment (the tab's active-env selection is section-local;
        // the port is fixed for the server's lifetime, so the base path is
        // what a hot edit needs kept resolved).
        const folder = useRestormStore.getState().findOwningEnvironmentFolder(design.id)
        void window.restorm?.designServer.update(resolveServedDesign(design, servedEnvVars(folder?.environments[0])))
      }
    })
    return () => { subscription.unsubscribe() }
  }, [design])

  // Recomputed only when a design edit ticked — a full walk of models ×
  // properties × routes × responses per keystroke would be waste. The
  // issues feed row-level errors, the sidebar dots and — later — the
  // design server / codegen gates.
  const issues = useMemo(() => {
    void designTick
    return validateApiDesign(design)
  }, [design, designTick])

  // Environment resolution is SHARED by two sections: the Server section
  // picks the active environment, the Settings section previews the resolved
  // base path against it. The selection lives HERE so it survives switching
  // between them (each section unmounts when left; this parent persists).
  // Subscribe to the collections DATA, not just the finder, so a later mirror
  // re-renders the environment list.
  const storeCollections = useRestormStore((state) => state.collections)
  const findOwningEnvironmentFolder = useRestormStore((state) => state.findOwningEnvironmentFolder)
  void storeCollections
  const owningFolder = findOwningEnvironmentFolder(design.id)
  const environments = owningFolder?.environments ?? []
  const [activeEnvIndex, setActiveEnvIndex] = useState(0)
  const activeEnv = environments[Math.min(activeEnvIndex, Math.max(0, environments.length - 1))]
  const envVars = servedEnvVars(activeEnv)

  const jumpTo = (section: 'models' | 'routes' | 'enums', entityId: string): void => {
    setActiveSection(section)
    if (section === 'models') setSelectedModelId(entityId)
    if (section === 'routes') setSelectedRouteEntityId(entityId)
    // 'enums' has no per-entity selection — switching the section is
    // the whole jump.
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
              <IconView icon={section.icon} size={16} />
            </button>
          </HeaderHoverTooltip>
        ))}
      </nav>
      <div className="design-section-host" data-testid={`design-section-${activeSection}`}>
        {activeSection === 'settings' && (
          <DesignSettingsSection design={design} envVars={envVars} hasEnvFolder={owningFolder !== null} />
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
          <DesignRoutesSection
            design={design}
            issues={issues}
            selectedEntityId={selectedRouteEntityId}
            onSelectEntity={setSelectedRouteEntityId}
          />
        )}
        {activeSection === 'server' && (
          <DesignServerSection
            design={design}
            issues={issues}
            environments={environments}
            activeEnvIndex={activeEnvIndex}
            onPickEnv={setActiveEnvIndex}
            envVars={envVars}
          />
        )}
        {activeSection === 'documentation' && (
          <DesignDocumentationSection design={design} designTick={designTick} onJumpTo={jumpTo} />
        )}
        {activeSection === 'notes' && (
          <DesignNotesSection design={design} tabId={tabId} />
        )}
        {activeSection === 'code' && (
          <DesignCodeSection design={design} issues={issues} />
        )}
      </div>
    </div>
  )
}

/**
 * Settings — design-server block on top (spin arrives with the design
 * server), then the API identity. Every edit reassigns a top-level
 * design key so the reactive proxy sees it.
 */
const AUTH_KINDS: readonly DesignAuthKind[] = ['none', 'bearer', 'apiKeyHeader', 'basic']

const DesignSettingsSection: React.FC<{
  design: ApiDesign
  /** Resolved variable map of the environment picked in the Server section. */
  envVars: Record<string, string>
  /** The design sits inside an env folder — only then is a resolved preview meaningful. */
  hasEnvFolder: boolean
}> = ({ design, envVars, hasEnvFolder }) => {
  const { t } = useTranslation()

  // The env-folder's variables as autocomplete definitions for the
  // variable-aware base-path field (serving itself lives in the Server
  // section now).
  const envVariables = useDesignEnvVariables(design.id)
  const handlebarsHelpers = useHandlebarsHelpers()
  const runLocked = isDesignRunLocked(useAuthState())
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

  // A resolved preview of the base path, echoing the field against the
  // environment picked in the Server section — sits right under the field.
  const rawBaseUrl = `${design.server?.host ?? ''}${design.server?.basePath ?? ''}`
  const resolvedBaseUrl = resolveUrlAgainstEnv(rawBaseUrl, envVars)

  // ── Descriptor export (combo + download) ──────────────────────────
  const [exportFormatIndex, setExportFormatIndex] = useState(0)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const downloadDescriptor = useCallback(async () => {
    const format = DESCRIPTOR_FORMATS[exportFormatIndex] ?? DESCRIPTOR_FORMATS[0]
    if (format === undefined) return
    setExportStatus(null)
    // Emit from a PLAIN clone — the emitter walks the whole design and
    // the reactive proxy has no business crossing that hot loop.
    const plain = JSON.parse(JSON.stringify(design)) as ApiDesign
    const content = format.emit(plain)
    const result = await window.restorm?.designServer.exportDescriptor(
      descriptorFileName(plain, format), content, format.fileExtension
    )
    if (result?.success === true && result.path !== undefined) {
      setExportStatus(t('design.settings.export.saved', 'Descriptor saved to {{path}}', { path: result.path }))
    } else if (result?.canceled !== true) {
      setExportStatus(result?.error ?? t('design.settings.export.failed', 'The export failed'))
    }
  }, [design, exportFormatIndex, t])

  return (
    <ScrollableElement className="design-section-scroll">
      <div className="design-section design-settings" data-testid="design-settings-section">
        <h2 className="design-section-title">{t('design.section.settings')}</h2>
        <p className="design-section-subtitle">
          {t('design.settings.subtitle', 'General settings of the design “{{name}}”', { name: design.name })}
        </p>

        <h3 className="design-settings-group-title">{t('design.settings.export.title', 'Export')}</h3>
        <div className="design-settings-grid design-export-fields">
          <label className="design-field design-field-wide">
            <span className="design-field-label">{t('design.settings.export.format', 'Descriptor format')}</span>
            <div className="design-export-row">
              <SelectBox
                id="design-export-format"
                className=""
                options={DESCRIPTOR_FORMATS.map((format) => ({ text: t(format.labelKey, format.label) }))}
                selected={Math.min(exportFormatIndex, DESCRIPTOR_FORMATS.length - 1)}
                onDidSelect={(data: ISelectData) => { setExportFormatIndex(data.index) }}
                selectBoxOptions={{ ariaLabel: t('design.settings.export.format', 'Descriptor format'), useCustomDrawn: true }}
                data-testid="design-export-format"
              />
              <GatedControl locked={runLocked} onSubscribe={() => { void subscribeToPro() }} data-testid="design-export-gate">
                <HeaderHoverTooltip label={t('design.settings.export.download', 'Download the descriptor')}>
                  {/* Exporting a descriptor is part of the paid run+export
                    * surface (DESIGN_RUN_CAPABILITY). `runLocked` also
                    * disables the button — GatedControl blocks pointers only. */}
                  <Button
                    secondary
                    icon="desktop-download"
                    onClick={() => { void downloadDescriptor() }}
                    disabled={runLocked}
                    options={{ ariaLabel: t('design.settings.export.download', 'Download the descriptor') }}
                    data-testid="design-export-download"
                  />
                </HeaderHoverTooltip>
              </GatedControl>
            </div>
          </label>
          {exportStatus !== null && (
            <p className="design-export-status design-field-full" data-testid="design-export-status">
              {exportStatus}
            </p>
          )}
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
              <RestormVariableInputBox
                value={design.server?.basePath ?? ''}
                onChange={patchServer}
                variables={envVariables}
                helpers={handlebarsHelpers}
                placeholder="/api/v1"
                ariaLabel={t('design.settings.api.basePath', 'Base path')}
                data-testid="design-settings-base-path"
              />
            </label>
            {hasEnvFolder && rawBaseUrl !== '' && (
              <p className="design-route-resolved design-field-full" data-testid="design-settings-resolved-base" data-resolved-url={resolvedBaseUrl}>
                {resolvedBaseUrl}
              </p>
            )}
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
