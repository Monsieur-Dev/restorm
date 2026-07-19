import React from 'react'
import { useTranslation } from 'react-i18next'
import { stringify as yamlStringify } from 'yaml'
import { CodeEditor, ReadOnlyOverlay } from 'electron-core-ui/renderer'
import { isEnvironmentFolder, isFolder, isScenario, isRequest, type FolderItem, type EnvironmentFolder, type Folder } from '../../../../shared/types/folderTypes'
import type { Scenario } from '../../../../shared/types/scenario'
import type { Request, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, ODataRequest } from '../../../../shared/types/requests'
import { EnvironmentProvider } from '../../contexts/EnvironmentContext'
import { FolderView } from '../Folders/FolderView'
import { EnvironmentFolderView } from '../Folders/EnvironmentFolderView'
import { ScenarioEditorView } from '../Scenario/ScenarioEditorView'
import { HTTPRequestTabView } from '../RequestTabViews/HTTPRequestTabView'
import { GraphQLRequestTabView } from '../RequestTabViews/GraphQLRequestTabView'
import { GrpcRequestTabView } from '../RequestTabViews/GrpcRequestTabView'
import { SoapRequestTabView } from '../RequestTabViews/SoapRequestTabView'
import { SoapServerRequestTabView } from '../RequestTabViews/SoapServerRequestTabView'
import { WebSocketRequestTabView } from '../RequestTabViews/WebSocketRequestTabView'
import { ODataRequestTabView } from '../RequestTabViews/ODataRequestTabView'
import type { EntityFieldDiff } from '../../services/conflictFieldDiff'

export type ConflictPanelMode = 'readOnly' | 'editable'

export interface ConflictEntityPanelProps {
  entity: FolderItem
  mode: ConflictPanelMode
  /** Only meaningful for scenarios (the only entity type edited via a
   * controlled callback rather than in-place proxy mutation — see
   * `conflictEntityClone.ts`). Ignored in `readOnly` mode. */
  onScenarioChange?: (scenarioId: string, patch: { nodes?: Scenario['nodes'], edges?: Scenario['edges'], notes?: string }) => void
  /** AC#4/#5: the entity kind's field-level diff, computed ONCE per
   * conflict (ours vs theirs) by the caller (`GitConflictResolutionModal`,
   * via `computeEntityFieldDiff`) and passed identically to all 3 panels.
   * `fields` (the red-border map) is applied in `readOnly` mode only —
   * AC#4 highlights differences on the user/server panels, not resolved.
   * `preselectTabId` applies to every panel regardless of mode — AC#5
   * preselects the conflict-bearing tab everywhere. `undefined` for kinds
   * that aren't field-diffed (scenarios, by design). */
  fieldDiff?: EntityFieldDiff
  /** Controlled request-side tab selection, shared by the modal across its
   * 3 columns: any column's tab strip drives it (`ReadOnlyOverlay` lets
   * tab clicks through as navigation) and every column mirrors it, keeping
   * the side-by-side comparison on the same tab. Request kinds only —
   * folder/scenario panels ignore it. */
  activeTabId?: string
  onActiveTabChange?: (tabId: string) => void
  'data-testid'?: string
}

/** Auth requests reuse `HTTPRequestTabView` verbatim in the live app too
 * (it injects a Configuration tab), so the conflict view mirrors that. */
function isHTTPPanelRequest(request: Request): request is Request & { type: 'http' | 'auth' } {
  return request.type === 'http' || request.type === 'auth'
}

/**
 * Renders the ONE normal entity panel for whichever kind `entity` is —
 * the restorm half of the ECUI/restorm split documented in `docs/Git/
 * README.md`'s "Conflict resolution" section. `readOnly` wraps the
 * SAME, unmodified panel in ECUI's `ReadOnlyOverlay` (AC#2); `editable`
 * renders it bare so the user can edit the resolved version directly.
 *
 * Folders / environment-folders / requests are mutated in place via the
 * app's reactive-proxy mechanism (the caller must pass an already
 * `cloneEntityForResolution`-wrapped `entity` for the editable case, so
 * edits don't leak into the ours/theirs snapshots). Scenarios go through
 * `onScenarioChange` instead — see that prop's doc.
 */
export const ConflictEntityPanel: React.FC<ConflictEntityPanelProps> = ({
  entity,
  mode,
  onScenarioChange,
  fieldDiff,
  activeTabId,
  onActiveTabChange,
  'data-testid': dataTestId
}) => {
  const content = renderEntity(entity, mode, onScenarioChange, fieldDiff, activeTabId, onActiveTabChange)
  if (mode === 'readOnly') {
    return <ReadOnlyOverlay {...(dataTestId ? { 'data-testid': dataTestId } : {})}>{content}</ReadOnlyOverlay>
  }
  return <div {...(dataTestId ? { 'data-testid': dataTestId } : {})} style={{ width: '100%', height: '100%' }}>{content}</div>
}

function renderEntity(
  entity: FolderItem,
  mode: ConflictPanelMode,
  onScenarioChange?: ConflictEntityPanelProps['onScenarioChange'],
  fieldDiff?: EntityFieldDiff,
  activeTabId?: string,
  onActiveTabChange?: (tabId: string) => void
): React.ReactNode {
  if (isEnvironmentFolder(entity)) {
    return renderEnvironmentFolder(entity, mode, fieldDiff)
  }
  if (isFolder(entity)) {
    return renderFolder(entity, mode, fieldDiff)
  }
  if (isScenario(entity)) {
    // Per Yoann's decision, scenarios are shown as a whole graph with NO
    // conflict highlighting — `fieldDiff` is never passed in for this kind
    // (`computeEntityFieldDiff` returns `undefined`), so there's nothing
    // to forward here.
    return (
      <ScenarioEditorView
        scenario={entity}
        {...(mode === 'editable' && onScenarioChange ? { onScenarioChange } : {})}
      />
    )
  }
  if (isRequest(entity)) {
    return renderRequest(entity, mode, fieldDiff, activeTabId, onActiveTabChange)
  }
  return <MonacoFallback entity={entity} mode={mode} />
}

function renderFolder(folder: Folder, mode: ConflictPanelMode, fieldDiff?: EntityFieldDiff): React.ReactNode {
  return (
    <EnvironmentProvider environments={undefined}>
      <FolderView
        folder={folder}
        {...(mode === 'readOnly' && fieldDiff ? { notesDiffers: fieldDiff.fields['notes'] } : {})}
        {...(fieldDiff?.preselectTabId ? { defaultActiveTabId: fieldDiff.preselectTabId } : {})}
      />
    </EnvironmentProvider>
  )
}

function renderEnvironmentFolder(folder: EnvironmentFolder, mode: ConflictPanelMode, fieldDiff?: EntityFieldDiff): React.ReactNode {
  return (
    <EnvironmentProvider environments={folder.environments}>
      <EnvironmentFolderView
        folder={folder}
        {...(mode === 'readOnly' && fieldDiff ? { notesDiffers: fieldDiff.fields['notes'] } : {})}
        {...(fieldDiff?.preselectTabId ? { defaultActiveTabId: fieldDiff.preselectTabId } : {})}
      />
    </EnvironmentProvider>
  )
}

function renderRequest(
  request: Request,
  mode: ConflictPanelMode,
  fieldDiff?: EntityFieldDiff,
  activeTabId?: string,
  onActiveTabChange?: (tabId: string) => void
): React.ReactNode {
  // Every field-diff-aware panel shares 3 conflict props: the red-border
  // map (readOnly only, AC#4), the tab preselect (every mode, AC#5), and
  // hiding the generated Code Snippets tab (every mode, AC#5). The
  // controlled tab pair (modal-shared, see `activeTabId`'s prop doc) rides
  // along; the `inert` read-only panels can never fire the callback, so
  // passing it to all 3 modes is harmless and keeps this spread uniform.
  const fieldDiffProps = {
    ...(mode === 'readOnly' && fieldDiff ? { conflictFieldDiff: fieldDiff } : {}),
    ...(fieldDiff?.preselectTabId ? { defaultActiveTabId: fieldDiff.preselectTabId } : {}),
    ...(activeTabId !== undefined ? { activeRequestTabId: activeTabId } : {}),
    ...(onActiveTabChange !== undefined ? { onRequestTabChange: onActiveTabChange } : {})
  }
  // Expansion-only diff map for ALL 3 columns (the resolved panel gets it
  // too, unlike the red-border `conflictFieldDiff`) so the columns open the
  // same sections and stay visually aligned. HTTP-only: it's the one panel
  // with per-section collapse driven by the diff's section booleans.
  const httpPanelProps = {
    ...fieldDiffProps,
    ...(fieldDiff ? { conflictPanelFields: fieldDiff.fields } : {})
  }
  // AC#2/#5 blanket safety rule (`conflictSafeLiveState.ts`): every panel
  // rendered here is a STATIC historical snapshot, never a live session —
  // `conflictMode` forces isListening/isSubscribing false and skips every
  // live event-stream subscription, regardless of readOnly vs. editable.
  const conflictMode = true

  if (isHTTPPanelRequest(request)) {
    return (
      <EnvironmentProvider environments={undefined}>
        <HTTPRequestTabView request={request} showCodeSnippets={false} conflictMode={conflictMode} {...httpPanelProps} />
      </EnvironmentProvider>
    )
  }

  // `isRequest` (the caller's guard) is a structural check — 'type' present,
  // no 'items', not a scenario — not a check against the known protocol
  // type strings, so a malformed or future-unknown request-shaped object
  // can still reach here despite the `Request` union looking exhaustive to
  // TypeScript. Switch on a widened `string` (rather than chained `if
  // (request.type === …)`) so that possibility stays real to the type
  // checker instead of being narrowed away — the `default` case below is a
  // genuine, reachable safety net, not dead code.
  const requestType: string = request.type
  switch (requestType) {
    case 'graphql':
      return (
        <EnvironmentProvider environments={undefined}>
          <GraphQLRequestTabView request={request as GraphQLRequest} showCodeSnippets={false} conflictMode={conflictMode} {...fieldDiffProps} />
        </EnvironmentProvider>
      )
    case 'grpc':
      return (
        <EnvironmentProvider environments={undefined}>
          <GrpcRequestTabView request={request as GrpcRequest} showCodeSnippets={false} conflictMode={conflictMode} {...fieldDiffProps} />
        </EnvironmentProvider>
      )
    case 'websocket':
      return (
        <EnvironmentProvider environments={undefined}>
          <WebSocketRequestTabView request={request as WebSocketRequest} showCodeSnippets={false} conflictMode={conflictMode} {...fieldDiffProps} />
        </EnvironmentProvider>
      )
    case 'odata':
      return (
        <EnvironmentProvider environments={undefined}>
          <ODataRequestTabView request={request as ODataRequest} showCodeSnippets={false} conflictMode={conflictMode} {...fieldDiffProps} />
        </EnvironmentProvider>
      )
    case 'soap': {
      // SOAP is the one protocol that doesn't dispatch client/server
      // internally (every other protocol's TabView branches on
      // `request.server` itself) — `RestormWorkbench.tsx` does it instead,
      // so this mirrors that same branch.
      const soapRequest = request as SoapRequest
      return (
        <EnvironmentProvider environments={undefined}>
          {soapRequest.server === true
            ? <SoapServerRequestTabView request={soapRequest} conflictMode={conflictMode} />
            : <SoapRequestTabView request={soapRequest} showCodeSnippets={false} {...fieldDiffProps} />}
        </EnvironmentProvider>
      )
    }
    default:
      // Unrecognized request type — the Monaco 3-pane fallback (AC#8).
      return <MonacoFallback entity={request} mode={mode} />
  }
}

/**
 * Fallback for entity kinds with no dedicated editor: a YAML view of the raw
 * object. It is **always read-only** — including the editable (resolved) pane —
 * because there is no structured writer to feed free-form YAML edits back into
 * the resolved snapshot, so the only safe resolution for these kinds is the
 * whole-entity pick-ours / pick-theirs above. The editable pane carries a short
 * notice saying exactly that, so the read-only Monaco doesn't read as a bug.
 */
const MonacoFallback: React.FC<{ entity: FolderItem, mode: ConflictPanelMode }> = ({ entity, mode }) => {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {mode === 'editable' && (
        <div
          style={{ padding: '6px 10px', fontSize: 12, opacity: 0.8 }}
          data-testid="conflict-monaco-fallback-notice"
        >
          {t('git.conflictReadOnlyEntityNotice')}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <CodeEditor
          value={yamlStringify(entity)}
          language="yaml"
          options={{ readOnly: true }}
          data-testid="conflict-monaco-fallback"
        />
      </div>
    </div>
  )
}

export default ConflictEntityPanel
