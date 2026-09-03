import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Callout,
  GatedControl,
  InputBox,
  ScrollableElement,
  Toggle
} from 'electron-core-ui/renderer'
import type { ApiDesign, DesignProtocol, DesignServing } from '../../../../shared/types/collections'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import { isDesignRunLocked } from '../../../../shared/auth/planCapabilities'
import { useAuthState } from 'electron-core-ui/renderer'
import { resolveUrlAgainstEnv } from '../../../../shared/utils/resolveUrlAgainstEnv'
import { subscribeToPro } from '../../services/subscribeToPro'
import { applyServingSnapshot, useIsDesignServerListening } from '../../services/designServerStore'
import { generateDesignClients, clearDesignClients, getDesignClients } from '../../services/designClientsStore'
import { setPendingDesignSection } from '../../services/designSectionIntent'
import { useDesignEnvVariables } from '../../hooks/useDesignEnvVariables'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { assignDesignSection } from './designMutations'
import { resolveServedDesign } from './designServeResolve'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RoundActionButton } from '../common/RoundActionButton'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { DesignRunPanel } from './DesignRunModal'

const SERVE_PROTOCOLS = ['http', 'graphql', 'soap', 'odata', 'grpc'] as const

/**
 * The Server section: the "Serve this design" controls (protocols, spin,
 * port, latency, stateful mode) — the block that used to sit at the top of
 * Settings — with the live run panel (every route, its per-run call
 * counters and forced-return controls) rendered INLINE right below, instead
 * of the old floating overlay that masked the rest of the tab.
 */
export const DesignServerSection: React.FC<{
  design: ApiDesign
  issues: DesignIssue[]
  /** Resolved variable map of the active environment (picked in the design
   * smart-bar env selector; used for the port preview and serve resolution). */
  envVars: Record<string, string>
}> = ({ design, issues, envVars }) => {
  const { t } = useTranslation()

  // A design INSIDE an env folder resolves {{variables}} like a request; the
  // active environment is picked by the parent (shared with Settings' base-path
  // preview). The port field's autocomplete uses the folder's variables.
  const envVariables = useDesignEnvVariables(design.id)
  const handlebarsHelpers = useHandlebarsHelpers()

  const runLocked = isDesignRunLocked(useAuthState())
  const serving = useIsDesignServerListening(design.id)
  // Reconcile with the main-side truth on mount: an MCP serve_design fired
  // before any design surface existed never reached the lazy subscription.
  useEffect(() => {
    let cancelled = false
    void window.restorm?.designServer.status(design.id).then((status) => {
      if (cancelled) return
      applyServingSnapshot(design.id, status.listening)
      // Reload / MCP-served: the transient clients live only in memory, so
      // regenerate them when a design is found already serving with none held.
      if (status.listening && status.port !== undefined && getDesignClients(design.id).length === 0) {
        void generateDesignClients(design, status.port)
      }
    })
    return () => { cancelled = true }
  }, [design])

  const [serverError, setServerError] = useState<string | null>(null)
  const [servedPort, setServedPort] = useState<number | null>(null)
  const port = design.serving?.port ?? 4820
  const latencyMs = design.serving?.latencyMs ?? 0
  const protocols = design.serving?.protocols ?? ['http']
  const blocked = issues.length > 0

  const patchServing = useCallback((patch: { port?: number | string | undefined; latencyMs?: number; stateful?: boolean }) => {
    const next = { ...(design.serving ?? {}), ...patch }
    if (next.port === undefined || next.port === '') delete next.port
    if (next.latencyMs === 0) delete next.latencyMs
    if (next.stateful !== true) delete next.stateful
    assignDesignSection(design, 'serving', next as DesignServing)
  }, [design])

  // A STABLE handler for the port field: a fresh inline arrow every render
  // makes the variable-input editor lose focus on the first click.
  const patchPort = useCallback((value: string) => {
    const trimmed = value.trim()
    patchServing({ port: trimmed === '' ? undefined : (/^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed) })
  }, [patchServing])

  const toggleProtocol = useCallback((protocol: DesignProtocol) => {
    if (protocol === 'http') return
    const current = design.serving?.protocols ?? []
    const enabled = current.includes(protocol)
    const nextProtocols = enabled ? current.filter((p) => p !== protocol) : [...current, protocol]
    const next = { ...(design.serving ?? {}) }
    if (nextProtocols.length === 0) delete next.protocols
    else next.protocols = nextProtocols
    assignDesignSection(design, 'serving', next)
  }, [design])

  const toggleServer = useCallback(async () => {
    setServerError(null)
    if (serving) {
      await window.restorm?.designServer.stop(design.id)
      // Drop the generated clients (their tabs are closed by the App-level
      // stop handler that watches the serving state).
      clearDesignClients(design.id)
      return
    }
    // Resolve base-path / port {{variables}} against the ACTIVE environment
    // (the smart-bar selection, already resolved into `envVars` by the parent),
    // then start. resolveServedDesign also strips the reactive proxy.
    const result = await window.restorm?.designServer.start(resolveServedDesign(design, envVars))
    if (result?.success !== true) {
      setServerError(result?.error ?? t('design.settings.serve.startFailed', 'The server could not start'))
      return
    }
    setServedPort(result.port)
    // Dogfood: import the mock's own metadata into transient client bundles.
    void generateDesignClients(design, result.port)
  }, [design, serving, t, envVars])

  const spinTooltip = serving
    ? t('design.run.stop', 'Stop the server')
    : blocked
      ? t('design.settings.serve.blocked', 'Fix the design’s {{count}} validation issue(s) before serving', { count: issues.length })
      : t('design.settings.serve.action', 'Serve this design')

  // The resolved port drives the run panel's request preview (the resolved
  // BASE path preview lives under its field in the Settings section now).
  const resolvedPortText = typeof port === 'string' ? resolveUrlAgainstEnv(port, envVars) : String(port)
  const headerPort = servedPort ?? (Number.parseInt(resolvedPortText, 10) || 4820)

  return (
    <ScrollableElement className="design-section-scroll">
      <div className="design-section design-server" data-testid="design-server-section">
        <p className="design-section-subtitle">
          {t('design.server.subtitle', 'Serve this design as a live mock and watch every call.')}
        </p>

        <div className="design-serve-block" data-testid="design-serve-block">
          <div className="design-serve-text">
            <span className="design-serve-title">{t('design.settings.serve.action', 'Serve this design')}</span>
            <span className="design-serve-description">
              {t('design.settings.serve.description', 'Responses from named examples · validation by constraints')}
            </span>
          </div>
          <div className="design-serve-protocols">
            {SERVE_PROTOCOLS.map((protocol) => {
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
              <RoundActionButton
                icon={serving ? 'debug-stop' : 'play'}
                tone={serving ? 'stop' : 'run'}
                beamActive={serving}
                onClick={() => { void toggleServer() }}
                disabled={runLocked || (!serving && blocked)}
                ariaLabel={spinTooltip}
                className={`design-serve-spin${serving ? ' design-serve-spin-active' : ''}`}
                data-testid="design-serve-spin"
              />
            </HeaderHoverTooltip>
          </GatedControl>
        </div>

        {serving && (
          <Callout
            variant="info"
            className="design-serve-clients-callout"
            data-testid="design-serve-clients-callout"
            message={t(
              'design.settings.serve.clientsCallout',
              'Your mock server is running. Ready-to-run clients were generated for every protocol this design serves.'
            )}
            actions={
              <Button
                data-testid="design-serve-clients-link"
                onClick={() => { setPendingDesignSection(design.id, 'clients') }}
              >
                {t('design.settings.serve.clientsCalloutLink', 'Find them here')}
              </Button>
            }
          />
        )}

        <div className="design-settings-grid design-serve-fields">
          <label className="design-field">
            <span className="design-field-label">{t('design.settings.serve.port', 'Port')}</span>
            <RestormVariableInputBox
              value={String(port)}
              onChange={patchPort}
              variables={envVariables}
              helpers={handlebarsHelpers}
              placeholder="4820"
              ariaLabel={t('design.settings.serve.port', 'Port')}
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

        <DesignRunPanel design={design} port={headerPort} />
      </div>
    </ScrollableElement>
  )
}
