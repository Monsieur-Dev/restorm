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
  Toggle,
  eventBus,
  useAuthState,
  usePersistedState,
  type ISelectData
} from 'electron-core-ui/renderer'
import type { ApiDesign, DesignAuthKind, DesignProtocol } from '../../../../shared/types/collections'
import type { DesignSectionKey } from '../../../../shared/types/editor'
import { DESIGN_SECTIONS } from '../../../../shared/design/designSections'
import { validateApiDesign, type DesignIssue } from '../../../../shared/design/validateApiDesign'
import { isDesignRunLocked } from '../../../../shared/auth/planCapabilities'
import { subscribeToPro } from '../../services/subscribeToPro'
import { applyServingSnapshot, isDesignServerListening, useIsDesignServerListening } from '../../services/designServerStore'
import { DESCRIPTOR_FORMATS, descriptorFileName } from '../../../../shared/design/descriptorFormats'
import { DesignRunModal } from './DesignRunModal'
import { DesignCodeSection } from './DesignCodeSection'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { consumePendingDesignSection, peekPendingDesignSection, subscribeDesignSectionIntent } from '../../services/designSectionIntent'
import { useRestormStore } from '../../store/restormStore'
import { resolveUrlAgainstEnv, flattenEnvVars, coerceEnvVarValue } from '../../../../shared/utils/resolveUrlAgainstEnv'
import type { Environment } from '../../../../shared/types/collections'
import { assignDesignSection } from './designMutations'
import { DesignModelsSection } from './DesignModelsSection'
import { DesignEnumsSection } from './DesignEnumsSection'
import { DesignRoutesSection } from './DesignRoutesSection'
import { DesignDocumentationSection } from './DesignDocumentationSection'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { BeamWrap } from '../common/BeamWrap'
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
        void window.restorm?.designServer.update(JSON.parse(JSON.stringify(design)))
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

  const jumpTo = (section: 'models' | 'routes' | 'enums', entityId: string): void => {
    setActiveSection(section)
    if (section === 'models') setSelectedModelId(entityId)
    if (section === 'routes') setSelectedRouteEntityId(entityId)
    // 'enums' has no per-entity selection — switching the section is
    // the whole jump.
  }

  // Run panel (scoped to THIS tab): opened by a successful spin, closed
  // by hand; survives section switches so the counters stay in sight
  // while editing routes. The stop keeps the panel open ("Server
  // stopped") — the state stays readable until the user dismisses it.
  // Open from the start when the design is ALREADY serving: the panel
  // state is tab-local and a tab switch remounts this view, so a
  // serving design re-shows its panel on return (lazy imperative read —
  // no effect, no cascading render). A manual close then sticks.
  const [runPanelOpen, setRunPanelOpen] = useState(() => isDesignServerListening(design.id))
  const [servedPort, setServedPort] = useState<number | null>(null)
  const stopServer = useCallback(() => {
    void window.restorm?.designServer.stop(design.id)
  }, [design.id])

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
          <DesignSettingsSection
            design={design}
            issues={issues}
            onServerStarted={(port) => {
              setServedPort(port)
              setRunPanelOpen(true)
            }}
          />
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
      {runPanelOpen && (
        <DesignRunModal
          design={design}
          port={servedPort ?? design.serving?.port ?? 4820}
          onStop={stopServer}
          onClose={() => { setRunPanelOpen(false) }}
        />
      )}
    </div>
  )
}

/**
 * Settings — design-server block on top (spin arrives with the design
 * server), then the API identity. Every edit reassigns a top-level
 * design key so the reactive proxy sees it.
 */
const AUTH_KINDS: readonly DesignAuthKind[] = ['none', 'bearer', 'apiKeyHeader', 'basic']

/** The raw variable map of one environment — same value coercion as the
 * documentation matcher's `envVarsFromFolder`. */
function envVarsFromEnvironment(env: Environment | undefined): Record<string, string> {
  if (!env) return {}
  const out: Record<string, string> = {}
  for (const kv of env.variables) {
    const coerced = coerceEnvVarValue(kv.value)
    if (coerced !== undefined) out[kv.key] = coerced
  }
  return out
}

const DesignSettingsSection: React.FC<{
  design: ApiDesign
  issues: DesignIssue[]
  onServerStarted: (port: number) => void
}> = ({ design, issues, onServerStarted }) => {
  const { t } = useTranslation()

  // A design INSIDE an env folder resolves {{variables}} like a request
  // does: the owning folder's environments feed the resolver, and the
  // active environment is picked right here (defaults to the first).
  // Subscribe to the COLLECTIONS DATA, not just the stable finder
  // function: selecting the function alone subscribes to nothing that
  // ever changes, so the store mirror landing an effect later would
  // never re-render this section (the zustand flavour of "a ref keeps
  // data fresh but cannot notify").
  const storeCollections = useRestormStore((state) => state.collections)
  const findOwningEnvironmentFolder = useRestormStore((state) => state.findOwningEnvironmentFolder)
  void storeCollections
  const owningFolder = findOwningEnvironmentFolder(design.id)
  const environments = owningFolder?.environments ?? []
  const [activeEnvIndex, setActiveEnvIndex] = useState(0)
  const activeEnv = environments[Math.min(activeEnvIndex, Math.max(0, environments.length - 1))]
  // Plain per-render computation — tiny maps, and manual memoization
  // here made the React compiler bail out of the whole component.
  const envVars = flattenEnvVars(envVarsFromEnvironment(activeEnv))
  const rawBaseUrl = `${design.server?.host ?? ''}${design.server?.basePath ?? ''}`
  const resolvedBaseUrl = resolveUrlAgainstEnv(rawBaseUrl, envVars)
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

  // ── Design server (the spin) ──────────────────────────────────────
  const serving = useIsDesignServerListening(design.id)
  // Reconcile with the main-side truth on mount: an MCP serve_design
  // fired before any design surface existed never reached the lazy
  // progress subscription — poll once so the spin reflects reality.
  useEffect(() => {
    let cancelled = false
    void window.restorm?.designServer.status(design.id).then((status) => {
      if (!cancelled) applyServingSnapshot(design.id, status.listening)
    })
    return () => { cancelled = true }
  }, [design.id])
  const [serverError, setServerError] = useState<string | null>(null)
  const runLocked = isDesignRunLocked(useAuthState())
  const port = design.serving?.port ?? 4820
  const latencyMs = design.serving?.latencyMs ?? 0
  const blocked = issues.length > 0

  const patchServing = useCallback((patch: { port?: number; latencyMs?: number; stateful?: boolean }) => {
    const next = { ...(design.serving ?? {}), ...patch }
    if (next.latencyMs === 0) delete next.latencyMs
    if (next.stateful !== true) delete next.stateful
    assignDesignSection(design, 'serving', next)
  }, [design])

  const toggleProtocol = useCallback((protocol: DesignProtocol) => {
    if (protocol === 'http') return
    const current = design.serving?.protocols ?? []
    const enabled = current.includes(protocol)
    const nextProtocols = enabled
      ? current.filter((p) => p !== protocol)
      : [...current, protocol]
    const next = { ...(design.serving ?? {}) }
    if (nextProtocols.length === 0) delete next.protocols
    else next.protocols = nextProtocols
    assignDesignSection(design, 'serving', next)
  }, [design])

  const toggleServer = useCallback(async () => {
    setServerError(null)
    if (serving) {
      await window.restorm?.designServer.stop(design.id)
      return
    }
    // The JSON round-trip strips the reactive proxy — the
    // contextBridge rejects proxied objects.
    const result = await window.restorm?.designServer.start(JSON.parse(JSON.stringify(design)))
    if (result?.success !== true) {
      setServerError(result?.error ?? t('design.settings.serve.startFailed', 'The server could not start'))
      return
    }
    onServerStarted(result.port)
  }, [design, onServerStarted, serving, t])

  const spinTooltip = serving
    ? t('design.run.stop', 'Stop the server')
    : blocked
      ? t('design.settings.serve.blocked', 'Fix the design’s {{count}} validation issue(s) before serving', { count: issues.length })
      : t('design.settings.serve.action', 'Serve this design')

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

        <h3 className="design-settings-group-title">{t('design.settings.serve.title', 'Design server')}</h3>
        <div className="design-serve-block" data-testid="design-serve-block">
          <div className="design-serve-text">
            <span className="design-serve-title">{t('design.settings.serve.action', 'Serve this design')}</span>
            <span className="design-serve-description">
              {t('design.settings.serve.description', 'Responses from named examples · validation by constraints')}
            </span>
          </div>
          <div className="design-serve-protocols">
            {(['http', 'graphql', 'soap', 'odata', 'grpc'] as const).map((protocol) => {
              const active = protocol === 'http' || protocols.includes(protocol)
              return (
                <button
                  key={protocol}
                  type="button"
                  className={`design-protocol-pill${active ? ' active' : ''}`}
                  data-testid={`design-protocol-${protocol}`}
                  disabled={protocol === 'http'}
                  title={protocol === 'http'
                    ? t('design.settings.serve.protocolAlways', 'HTTP is always served')
                    : t('design.settings.serve.protocolToggle', 'Serve this projection too')}
                  onClick={() => { toggleProtocol(protocol) }}
                >
                  {t(`design.protocol.${protocol}`)}
                </button>
              )
            })}
          </div>
          <GatedControl locked={runLocked} onSubscribe={() => { void subscribeToPro() }} data-testid="design-serve-gate">
            <HeaderHoverTooltip label={spinTooltip}>
              <BeamWrap active={serving} size={26} borderWidth={1.5}>
                {/* `runLocked` must ALSO disable the button: GatedControl
                  * blocks pointers only (pointer-events) — a focusable
                  * button still activates on Enter/Space. */}
                <Button
                  appearance="round"
                  icon={serving ? 'debug-stop' : 'play'}
                  onClick={() => { void toggleServer() }}
                  disabled={runLocked || (!serving && blocked)}
                  className={`design-serve-spin${serving ? ' design-serve-spin-active' : ''}`}
                  options={{ ariaLabel: spinTooltip }}
                  data-testid="design-serve-spin"
                />
              </BeamWrap>
            </HeaderHoverTooltip>
          </GatedControl>
        </div>
        <div className="design-settings-grid design-serve-fields">
          <label className="design-field">
            <span className="design-field-label">{t('design.settings.serve.port', 'Port')}</span>
            <InputBox
              value={String(port)}
              onChange={(value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) patchServing({ port: parsed })
              }}
              options={{ type: 'number', ariaLabel: t('design.settings.serve.port', 'Port') }}
              data-testid="design-serve-port"
            />
          </label>
          <label className="design-field">
            <span className="design-field-label">{t('design.settings.serve.latency', 'Simulated latency (ms)')}</span>
            <InputBox
              value={String(latencyMs)}
              onChange={(value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed >= 0) patchServing({ latencyMs: parsed })
              }}
              options={{ type: 'number', ariaLabel: t('design.settings.serve.latency', 'Simulated latency (ms)') }}
              data-testid="design-serve-latency"
            />
          </label>
          <label className="design-field design-field-full design-serve-stateful">
            <Toggle
              checked={design.serving?.stateful === true}
              onChange={(checked) => { patchServing({ stateful: checked }) }}
              data-testid="design-serve-stateful"
            />
            <span className="design-field-label">
              {t('design.settings.serve.stateful', 'Stateful mode — POST/PUT/DELETE mutate an in-memory store (reset on restart)')}
            </span>
          </label>
          {serverError !== null && (
            <p className="design-serve-error design-field-full" role="alert" data-testid="design-serve-error">
              {serverError}
            </p>
          )}
        </div>

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
              <InputBox
                value={design.server?.basePath ?? ''}
                onChange={patchServer}
                options={{ type: 'text', placeholder: '/api/v1', ariaLabel: t('design.settings.api.basePath', 'Base path') }}
                data-testid="design-settings-base-path"
              />
            </label>
            {environments.length > 0 && (
              <label className="design-field">
                <span className="design-field-label">{t('design.settings.api.environment', 'Environment')}</span>
                <SelectBox
                  id="design-settings-environment"
                  className=""
                  options={environments.map((env) => ({ text: env.name }))}
                  selected={Math.min(activeEnvIndex, environments.length - 1)}
                  onDidSelect={(data: ISelectData) => { setActiveEnvIndex(data.index) }}
                  selectBoxOptions={{ ariaLabel: t('design.settings.api.environment', 'Environment'), useCustomDrawn: true }}
                  data-testid="design-settings-environment"
                />
              </label>
            )}
            {owningFolder !== null && rawBaseUrl !== '' && (
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
