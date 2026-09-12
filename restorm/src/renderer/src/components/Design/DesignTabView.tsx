import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  GatedControl,
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
import { validateApiDesignCached } from '../../../../shared/design/validateApiDesign'
import { isDesignRunLocked } from '../../../../shared/auth/planCapabilities'
import { subscribeToPro } from '../../services/subscribeToPro'
import { isDesignServerListening } from '../../services/designServerStore'
import { DESCRIPTOR_FORMATS, descriptorFileName } from '../../../../shared/design/descriptorFormats'
import { DesignServerSection } from './DesignServerSection'
import { DesignClientsSection } from './DesignClientsSection'
import { resolveServedDesign, servedEnvVars } from './designServeResolve'
import { resolveUrlAgainstEnv } from '../../../../shared/utils/resolveUrlAgainstEnv'
import { ensureLeadingSlash } from '../../../../shared/design/apiDesignDoc'
import { DesignCodeSection } from './DesignCodeSection'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { consumePendingDesignSection, peekPendingDesignSection, subscribeDesignSectionIntent, setActiveDesignSection, setActiveDesignEntity } from '../../services/designSectionIntent'
import type { DesignEntityAction, DesignSectionIntent, ActiveDesignEntity } from '../../services/designSectionIntent'
import { designSectionRowId, designEntityRowId, type DesignEntitySection } from '../../../../shared/design/designSections'
import { useRestormStore } from '../../store/restormStore'
import { useOptionalEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { findEnvironmentById } from '../../services/environmentSelectionStore'
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
  // PEEK only in the initializers: StrictMode double-invokes them in dev
  // builds, so a consuming read would drain the map on the throwaway
  // call. The mount effect below does the consuming.
  // Persisted per design (user setting, NOT the .restorm file): the last section
  // is restored across tab switches AND file reopen — EXCEPT when a navigation
  // intent opened this tab (a sidebar section click): then the click's section
  // is the initial value AND the async storage restore is ignored (`onRestore`),
  // so the persisted section can't land late and steal the sidebar selection off
  // the clicked one.
  const openedFromSectionIntent = useRef(peekPendingDesignSection(design.id) !== undefined)
  const [activeSection, setActiveSection] = usePersistedState<DesignSectionKey>(
    `design-active-section:${design.id}`,
    peekPendingDesignSection(design.id)?.section ?? 'settings',
    { onRestore: (stored) => openedFromSectionIntent.current ? undefined : stored }
  )
  // Publish where the tab IS so the sidebar highlights the matching section
  // row — even when the tab is refocused from another tab (handleTabActivate
  // reads this) rather than from a fresh row click.
  useEffect(() => {
    setActiveDesignSection(design.id, activeSection)
  }, [design.id, activeSection])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    const intent = peekPendingDesignSection(design.id)
    return intent?.section === 'models' ? intent.entityId ?? null : null
  })
  const [selectedRouteEntityId, setSelectedRouteEntityId] = useState<string | null>(() => {
    const intent = peekPendingDesignSection(design.id)
    return intent?.section === 'routes' ? intent.entityId ?? null : null
  })
  const [selectedEnumId, setSelectedEnumId] = useState<string | null>(() => {
    const intent = peekPendingDesignSection(design.id)
    return intent?.section === 'enums' ? intent.entityId ?? null : null
  })
  // The Clients section can be SCOPED to one client folder (a `design-client:`
  // row id): clicking a protocol/sub-folder in the sidebar shows just that
  // folder's descriptor + child tree. `null` = the whole Clients view.
  const [clientsScopeId, setClientsScopeId] = useState<string | null>(() => {
    const intent = peekPendingDesignSection(design.id)
    return intent?.section === 'clients' ? intent.entityId ?? null : null
  })

  // A context-menu action a sidebar node asked a section to run (add / clone /
  // delete / generate CRUD). Bumped `nonce` lets a section fire the action once
  // per request even across a remount; `null` = no pending action.
  const [entityAction, setEntityAction] = useState<{ section: DesignSectionKey; action: DesignEntityAction; entityId?: string; nonce: number } | null>(null)
  const actionNonce = useRef(0)
  const fireEntityAction = useCallback((intent: DesignSectionIntent): void => {
    // A plain navigation (no action) CLEARS any pending action: a one-shot
    // add/clone/delete must never survive to re-fire when its section component
    // remounts on the next visit (the remount resets the section's nonce guard,
    // so a lingering action would duplicate the entity — seen on enums + routes).
    if (intent.action === undefined) { setEntityAction(null); return }
    actionNonce.current += 1
    setEntityAction({
      section: intent.section,
      action: intent.action,
      nonce: actionNonce.current,
      ...(intent.entityId !== undefined ? { entityId: intent.entityId } : {})
    })
  }, [])

  const applyIntent = useCallback((intent: DesignSectionIntent): void => {
    setActiveSection(intent.section)
    // Selection FOLLOWS the intent's entity, including its ABSENCE: clicking a
    // section ROW (no entity) clears the selection so the section shows its
    // listing overview, not a stale detail. Clicking an entity node selects it.
    if (intent.section === 'models') setSelectedModelId(intent.entityId ?? null)
    if (intent.section === 'routes') setSelectedRouteEntityId(intent.entityId ?? null)
    if (intent.section === 'enums') setSelectedEnumId(intent.entityId ?? null)
    // Clients scope follows the intent's entity — including its ABSENCE, which
    // resets to the full view (a click on the Clients section root).
    if (intent.section === 'clients') setClientsScopeId(intent.entityId ?? null)
    fireEntityAction(intent)
  }, [setActiveSection, fireEntityAction])

  // Follow section intents while THIS tab stays mounted — the single-tab policy
  // refocuses an already-open tab on a sidebar section click. On mount, DRAIN
  // the pending intent that opened this tab (the lazy initializers already
  // reflect its section/entity) but still run any pending ACTION it carried, so
  // a context-menu action that COLD-opens the tab isn't lost.
  useEffect(() => {
    const drained = consumePendingDesignSection(design.id)
    // Defer the mount-drain off the synchronous effect body so the setState it
    // runs doesn't cascade-render inside this same commit.
    if (drained !== undefined) queueMicrotask(() => { fireEntityAction(drained) })
    return subscribeDesignSectionIntent((designId, intent) => {
      if (designId !== design.id) return
      consumePendingDesignSection(design.id)
      applyIntent(intent)
    })
  }, [design.id, applyIntent, fireEntityAction])

  // Environment resolution is SHARED across sections: the base-path/port
  // previews resolve against the environment picked in the design smart-bar
  // selector (the shared EnvironmentProvider mounted around this tab in
  // RestormWorkbench). Subscribe to the collections DATA, not just the finder,
  // so a later mirror re-renders the environment list. Optional context so a
  // provider-less render (tests) still falls back to the first env.
  const storeCollections = useRestormStore((state) => state.collections)
  const findOwningEnvironmentFolder = useRestormStore((state) => state.findOwningEnvironmentFolder)
  void storeCollections
  const owningFolder = findOwningEnvironmentFolder(design.id)
  const environments = owningFolder?.environments ?? []
  const envContext = useOptionalEnvironmentContext()
  const activeEnv = (envContext?.selectedEnvId != null
    ? findEnvironmentById(environments, envContext.selectedEnvId)
    : undefined) ?? environments[0]
  const envVars = servedEnvVars(activeEnv)

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
      // rejects proxied objects). Resolve against the CURRENTLY selected
      // environment; the port is fixed for the server's lifetime, so the base
      // path is what a hot edit needs kept resolved.
      if (isDesignServerListening(design.id)) {
        void window.restorm?.designServer.update(resolveServedDesign(design, servedEnvVars(activeEnv)))
      }
    })
    return () => { subscription.unsubscribe() }
  }, [design, activeEnv])

  // Recomputed only when a design edit ticked — a full walk of models ×
  // properties × routes × responses per keystroke would be waste. The
  // issues feed row-level errors, the sidebar dots and — later — the
  // design server / codegen gates.
  const issues = useMemo(() => {
    void designTick
    return validateApiDesignCached(design)
  }, [design, designTick])

  // Publish the selected entity so the tab breadcrumb can read `… / Section /
  // Entity` (with a working link back to the section). Null when the section
  // shows its listing (no entity selected). `designTick` in the deps retitles
  // the crumb live on a rename.
  useEffect(() => {
    void designTick
    // The label feeds the editable H1 (an ECUI EditableLabel). Pass the RAW name
    // — even when empty — so the label renders its own muted "<sans nom>"
    // placeholder and keeps the rename pencil reachable, instead of us baking a
    // non-empty fallback here that the component would show as a real name.
    // The sidebar rows to expand to reveal an entity: always the design node and
    // its section row, plus the parent chain (a model's `inheritsFrom` ancestors,
    // a route's owning group and that group's parent groups).
    const base = (section: DesignEntitySection): string[] => [design.id, designSectionRowId(design.id, section)]
    const modelAncestors = (modelId: string): string[] => {
      const rows: string[] = []
      const seen = new Set<string>()
      let cur = design.models.find((m) => m.id === modelId)?.design?.inheritsFrom
      while (cur !== undefined && !seen.has(cur) && design.models.some((m) => m.id === cur)) {
        seen.add(cur)
        rows.push(designEntityRowId(design.id, 'models', cur))
        cur = design.models.find((m) => m.id === cur)?.design?.inheritsFrom
      }
      return rows
    }
    const groupChain = (groupId: string): string[] => {
      const rows: string[] = []
      const seen = new Set<string>()
      let cur: string | undefined = groupId
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur)
        rows.push(designEntityRowId(design.id, 'routes', cur))
        cur = design.routeGroups.find((g) => g.id === cur)?.parentId
      }
      return rows
    }

    let entity: ActiveDesignEntity | null = null
    if (activeSection === 'models' && selectedModelId !== null) {
      const m = design.models.find((x) => x.id === selectedModelId)
      if (m) entity = { section: 'models', entityId: m.id, label: m.doc.name, ancestorRowIds: [...base('models'), ...modelAncestors(m.id)] }
    } else if (activeSection === 'enums' && selectedEnumId !== null) {
      const e = design.enums.find((x) => x.id === selectedEnumId)
      if (e) entity = { section: 'enums', entityId: e.id, label: e.doc.name, ancestorRowIds: base('enums') }
    } else if (activeSection === 'routes' && selectedRouteEntityId !== null) {
      const g = design.routeGroups.find((x) => x.id === selectedRouteEntityId)
      if (g !== undefined) {
        // A group reveals via its own parent chain (not counting itself).
        entity = { section: 'routes', entityId: g.id, label: g.doc.name, ancestorRowIds: [...base('routes'), ...groupChain(g.id).slice(1)] }
      } else {
        for (const grp of design.routeGroups) {
          const r = grp.routes.find((x) => x.id === selectedRouteEntityId)
          if (r !== undefined) {
            entity = { section: 'routes', entityId: r.id, label: (r.doc.summary !== undefined && r.doc.summary !== '') ? r.doc.summary : r.doc.match.urlPattern, ancestorRowIds: [...base('routes'), ...groupChain(grp.id)] }
            break
          }
        }
      }
    }
    setActiveDesignEntity(design.id, entity)
  }, [design, activeSection, selectedModelId, selectedEnumId, selectedRouteEntityId, designTick])

  useEffect(() => () => { setActiveDesignEntity(design.id, null) }, [design.id])

  const jumpTo = (section: 'models' | 'routes' | 'enums', entityId: string): void => {
    setActiveSection(section)
    if (section === 'models') setSelectedModelId(entityId)
    if (section === 'routes') setSelectedRouteEntityId(entityId)
    if (section === 'enums') setSelectedEnumId(entityId)
  }

  return (
    <div className="design-tab-view" data-testid={`design-tab-view-${design.id}`}>
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
            pendingAction={entityAction?.section === 'models' ? entityAction : null}
          />
        )}
        {activeSection === 'enums' && (
          <DesignEnumsSection
            design={design}
            issues={issues}
            selectedEnumId={selectedEnumId}
            onSelectEnum={setSelectedEnumId}
            onJumpTo={jumpTo}
            pendingAction={entityAction?.section === 'enums' ? entityAction : null}
          />
        )}
        {activeSection === 'routes' && (
          <DesignRoutesSection
            design={design}
            issues={issues}
            selectedEntityId={selectedRouteEntityId}
            onSelectEntity={setSelectedRouteEntityId}
            onJumpTo={jumpTo}
            pendingAction={entityAction?.section === 'routes' ? entityAction : null}
          />
        )}
        {activeSection === 'server' && (
          <DesignServerSection
            design={design}
            issues={issues}
            envVars={envVars}
          />
        )}
        {activeSection === 'clients' && (
          <DesignClientsSection design={design} scopeId={clientsScopeId} />
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
  // The base path is rooted here (the same slash the server adds at serve time),
  // so a user who typed `api/v1` sees the served `/api/v1` without the field
  // itself being rewritten under their cursor.
  const rawBaseUrl = `${design.server?.host ?? ''}${design.server?.basePath ?? ''}`
  const resolvedHost = resolveUrlAgainstEnv(design.server?.host ?? '', envVars)
  const resolvedBasePath = ensureLeadingSlash(resolveUrlAgainstEnv(design.server?.basePath ?? '', envVars))
  const resolvedBaseUrl = `${resolvedHost}${resolvedBasePath}`

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
            {/* A div, not a label: a <label> binds to its first labelable
                descendant, which for a Monaco variable input is the editor's
                READ-ONLY IME textarea — so clicking the field would focus a dead
                element instead of the editor. `ariaLabel` carries the a11y name. */}
            <div className="design-field">
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
            </div>
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
  return (
    <div className="design-section design-notes-section">
      <MarkdownEditor
        key={`${tabId}-notes`}
        initialValue={design.notes ?? ''}
        onChange={(md: string) => { assignDesignSection(design, 'notes', md) }}
        data-testid="design-notes-editor"
      />
    </div>
  )
}
