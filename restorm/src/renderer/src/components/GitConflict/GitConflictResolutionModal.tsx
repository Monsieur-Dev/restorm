import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { Modal, Button, Breadcrumb, ConflictResolutionView } from 'electron-core-ui/renderer'
import type { UseConflictResolutionResult } from '../../hooks/useConflictResolution'
import { ConflictEntityPanel } from './ConflictEntityPanel'
import { ConflictQuickConfigBand } from './ConflictQuickConfigBand'
import { computeEntityFieldDiff, readQuickConfigs } from '../../services/conflictFieldDiff'
import { isRequest, type FolderItem } from '../../../../shared/types/folderTypes'
import { RegistryBadge } from '../common/RegistryBadge'
import { requestBadgeId } from '../../utils/badgeUtils'

/** Which side each conflicting quick-config currently resolves to: an explicit
 * per-config pick wins; otherwise it's derived from the resolved entity's
 * current config (which side its content matches), so a whole-entity pick is
 * reflected until the user overrides an individual config. */
function deriveCurrentSides(
  names: string[],
  resolved: FolderItem,
  theirs: FolderItem,
  picks: Record<string, 'ours' | 'theirs'> | undefined
): Record<string, 'ours' | 'theirs'> {
  const resolvedConfigs = readQuickConfigs(resolved)
  const theirsConfigs = readQuickConfigs(theirs)
  const sig = (configs: ReturnType<typeof readQuickConfigs>, name: string): string =>
    JSON.stringify(configs.find((c) => c.name === name)?.fields)
  const sides: Record<string, 'ours' | 'theirs'> = {}
  for (const name of names) {
    const explicit = picks?.[name]
    sides[name] = explicit ?? (sig(resolvedConfigs, name) === sig(theirsConfigs, name) ? 'theirs' : 'ours')
  }
  return sides
}

/** Column wrapper so the quick-config band sits above the entity panel and the
 * panel fills the remaining height. */
const panelWithBandStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%' }
const panelBodyStyle: React.CSSProperties = { flex: 1, minHeight: 0 }
/** The "which saved configuration is contested" line, directly under the
 * breadcrumb so it reads as a qualifier of the entity above it. */
const quickConfigBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 4,
  fontSize: 12,
  opacity: 0.9
}
/** The "nothing chosen yet" state of the resolved column: centred on both
 * axes so it reads as a prompt, not as content. */
const unresolvedPlaceholderStyle: React.CSSProperties = {
  height: '100%',
  // Without border-box the 24px padding is ADDED to the full height, so
  // the placeholder overflows its column and covers the footer — the
  // Cancel button underneath stops being clickable.
  boxSizing: 'border-box',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: 24,
  textAlign: 'center',
  opacity: 0.9
}
/** The identity band above the columns: WHICH entity is being resolved —
 * ONE plain (read-only) breadcrumb whose last item is the entity itself,
 * badge as its prefix, so path and name sit flush on a single line. */
const entityBandStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '4px 12px 8px', overflow: 'hidden', whiteSpace: 'nowrap' }

export interface GitConflictResolutionModalProps {
  isOpen: boolean
  conflictResolution: UseConflictResolutionResult
  onClose: () => void
  onFinish: () => void
}

/**
 * Mounts the generic `ConflictResolutionView` shell with restorm's
 * `ConflictEntityPanel` dispatcher wired into every render prop — the
 * concrete "4-panel conflict resolution UI" a pull conflict opens. All
 * entity state comes from `useGitPullConflict` (via its
 * `conflictResolution` sub-result) through the parent; the only state
 * owned here is the shared request-tab selection below.
 */
export const GitConflictResolutionModal: React.FC<GitConflictResolutionModalProps> = ({
  isOpen,
  conflictResolution,
  onClose,
  onFinish
}) => {
  const { t } = useTranslation()
  const { conflicts, selectedConflictId, selectConflict, getResolvedEntity, pickOursVersion, pickTheirsVersion, onScenarioChange, quickConfigPicks, pickQuickConfigVersion, resolvedEpochById, pickedSideById, onResolvedEdited, isResolved, allResolved, resolveItemOnSide, setResolvedName, setResolvedTags } = conflictResolution

  // ECUI's `ConflictResolutionView` always renders all three panels for the
  // SAME (selected) conflict, so the field-diff is identical across them.
  // Compute it once here (keyed on the selected conflict) instead of letting
  // each render prop recompute it — three passes of `computeEntityFieldDiff`
  // per render otherwise.
  const activeFieldDiff = useMemo(() => {
    const conflict = conflicts.find((c) => c.id === selectedConflictId)
    return conflict ? computeEntityFieldDiff(conflict.kind, conflict.ours, conflict.theirs) : undefined
  }, [conflicts, selectedConflictId])

  // ONE request-tab selection shared by the 3 columns: clicking a tab in
  // ANY column (tab strips are navigation, so `ReadOnlyOverlay` lets the
  // read-only columns' strips through) moves all three together — the
  // side-by-side comparison always shows the same tab.
  // The pick is stored WITH the conflict id it belongs to (instead of an
  // effect-based reset, which would cascade a render): selecting another
  // conflict makes the stored pick stale and the fallback (the diff's
  // preselected tab) takes over.
  const [sharedTab, setSharedTab] = useState<{ conflictId: string | null, tabId: string } | null>(null)
  const sharedTabId = sharedTab !== null && sharedTab.conflictId === selectedConflictId ? sharedTab.tabId : null
  const effectiveTabId = sharedTabId ?? activeFieldDiff?.preselectTabId ?? 'request'

  const selectedConflict = conflicts.find((c) => c.id === selectedConflictId)
  const ancestorSegments = selectedConflict?.pathSegments ?? []

  // Monaco-backed fields (URL, body) commit their edit through a ~200ms
  // debounce: the input event that reaches our capture handler fires BEFORE
  // the reactive proxy holds the new value. Re-derive once more after the
  // debounce flushed, or the LAST keystroke's equality (green checks) would
  // be computed against the pre-edit value and stick.
  const resolvedEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (resolvedEditTimerRef.current !== null) clearTimeout(resolvedEditTimerRef.current)
  }, [])
  // Both bumps are DEFERRED on purpose. These handlers run in the capture
  // phase, before React evaluates the field's own `onChange`: a state
  // update issued here re-renders the controlled input back to its last
  // committed value, so React then sees no change and the edit is
  // swallowed. Letting the event finish first keeps the field's own
  // handler intact; the checks re-derive a tick later.
  const reportResolvedEdited = (conflictId: string): void => {
    setTimeout(() => { onResolvedEdited(conflictId) }, 0)
    if (resolvedEditTimerRef.current !== null) clearTimeout(resolvedEditTimerRef.current)
    resolvedEditTimerRef.current = setTimeout(() => { onResolvedEdited(conflictId) }, 350)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('git.conflictResolutionTitle')}
      data-testid="git-conflict-resolution-modal"
      enterActionTestId="git-conflict-resolution-finish"
    >
      {/* Fill the modal body entirely (it's a flex column): the footer's
        * Annuler/Terminer row must sit at the BOTTOM edge of the modal, not
        * float mid-air under the columns. */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {selectedConflict && (
          <div style={entityBandStyle} data-testid="git-conflict-entity-band">
            <Breadcrumb
              items={[
                ...ancestorSegments.map((label, index) => ({ id: `ancestor-${index}`, label })),
                {
                  id: 'conflict-entity',
                  label: selectedConflict.name,
                  ...(isRequest(selectedConflict.ours)
                    ? { prefix: <RegistryBadge badgeId={requestBadgeId(selectedConflict.ours)} /> }
                    : {})
                }
              ]}
              plain
              showRoot
              ariaLabel={t('git.conflictEntityPath')}
              data-testid="git-conflict-entity-breadcrumb"
            />
            {selectedConflict.quickConfigName !== undefined && (
              // A quick-config conflict looks exactly like a request diff,
              // so without this line the user has no way to tell WHICH of
              // the request's saved configurations they are arbitrating.
              <div style={quickConfigBannerStyle} data-testid="git-conflict-quick-config-banner">
                <span className="codicon codicon-list-ordered" aria-hidden="true" />
                <span>{t('git.conflictOnQuickConfig', { name: selectedConflict.quickConfigName })}</span>
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <ConflictResolutionView
            conflicts={conflicts.map((conflict) => ({
              id: conflict.id,
              // Quick-config entries carry both names: the request alone
              // would show several identical rows.
              label: conflict.quickConfigName === undefined
                ? conflict.name
                : `${conflict.name} - ${conflict.quickConfigName}`,
              resolved: isResolved(conflict.id)
            }))}
            selectedConflictId={selectedConflictId}
            onSelectConflict={selectConflict}
            renderUserPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              if (!conflict) return null
              const names = activeFieldDiff?.conflictingQuickConfigNames ?? []
              return (
                <div style={panelWithBandStyle}>
                  <ConflictQuickConfigBand mode="readOnly" conflictingNames={names} data-testid="conflict-quick-config-band-user" />
                  <div style={panelBodyStyle}>
                    <ConflictEntityPanel data-testid="conflict-panel-user" {...(conflict.movedItemIds ? { movedItemIds: conflict.movedItemIds } : {})} entity={conflict.ours} resolveBoundItem={(itemId) => resolveItemOnSide('ours', itemId)} mode="readOnly" activeTabId={effectiveTabId} onActiveTabChange={(tabId) => { setSharedTab({ conflictId: selectedConflictId, tabId }) }} {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
                  </div>
                </div>
              )
            }}
            renderServerPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              if (!conflict) return null
              const names = activeFieldDiff?.conflictingQuickConfigNames ?? []
              return (
                <div style={panelWithBandStyle}>
                  <ConflictQuickConfigBand mode="readOnly" conflictingNames={names} data-testid="conflict-quick-config-band-server" />
                  <div style={panelBodyStyle}>
                    <ConflictEntityPanel data-testid="conflict-panel-server" {...(conflict.movedItemIds ? { movedItemIds: conflict.movedItemIds } : {})} entity={conflict.theirs} resolveBoundItem={(itemId) => resolveItemOnSide('theirs', itemId)} mode="readOnly" activeTabId={effectiveTabId} onActiveTabChange={(tabId) => { setSharedTab({ conflictId: selectedConflictId, tabId }) }} {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
                  </div>
                </div>
              )
            }}
            renderResolvedPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              const names = activeFieldDiff?.conflictingQuickConfigNames ?? []
              const resolved = getResolvedEntity(id)
              if (!resolved) {
                // Undecided on purpose: showing a pre-filled copy of our
                // side here made the choice look already made, and let the
                // user finish without ever looking at what the server
                // proposed.
                return (
                  <div style={unresolvedPlaceholderStyle} data-testid="conflict-resolved-placeholder">
                    <span>{t('git.conflictChooseVersion')}</span>
                    {/* The hint names the control AND draws it inline: the
                      * check button sits small in a column header, and a
                      * text-only instruction leaves the user hunting for
                      * it. `<0>` is the placeholder the icon replaces. */}
                    <span style={{ opacity: 0.75, fontSize: 12 }}>
                      <Trans
                        i18nKey="git.conflictChooseVersionHint"
                        components={[
                          <i
                            key="check"
                            className="codicon codicon-check"
                            aria-hidden="true"
                            style={{ verticalAlign: 'text-bottom' }}
                            data-testid="conflict-resolved-placeholder-check-icon"
                          />
                        ]}
                      />
                    </span>
                  </div>
                )
              }
              return (
                <div style={panelWithBandStyle}>
                  {conflict && (
                    <ConflictQuickConfigBand
                      mode="editable"
                      conflictingNames={names}
                      currentSides={deriveCurrentSides(names, resolved, conflict.theirs, quickConfigPicks[id])}
                      onPick={(name, side) => { pickQuickConfigVersion(id, name, side) }}
                      data-testid="conflict-quick-config-band-resolved"
                    />
                  )}
                  {/* The key remounts the editable panel on every ours/theirs
                    * pick — its tab view seeds fields into local state once, so
                    * without a remount the picked values would never display.
                    * Hand edits (input/change bubbling from the fields) clear
                    * the green side checks; Monaco-hosted editors don't bubble
                    * these, so scenario/body edits clear via their own change
                    * callbacks instead. */}
                  <div
                    style={panelBodyStyle}
                    onInputCapture={() => { reportResolvedEdited(id) }}
                    onChangeCapture={() => { reportResolvedEdited(id) }}
                  >
                    <ConflictEntityPanel
                      data-testid="conflict-panel-resolved"
                      {...(conflict?.movedItemIds ? { movedItemIds: conflict.movedItemIds } : {})}
                      key={`${id}:${resolvedEpochById[id] ?? 0}`}
                      entity={resolved}
                      resolveBoundItem={(itemId) => resolveItemOnSide('ours', itemId)}
                      onNameChange={(name) => { setResolvedName(id, name) }}
                      onTagsChange={(tags) => { setResolvedTags(id, tags) }}
                      mode="editable"
                      activeTabId={effectiveTabId}
                      onActiveTabChange={(tabId) => { setSharedTab({ conflictId: selectedConflictId, tabId }) }}
                      {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})}
                      onScenarioChange={(_scenarioId, patch) => { onScenarioChange(id, patch) }}
                    />
                  </div>
                </div>
              )
            }}
            {...(selectedConflictId ? { onUseUserVersion: () => { pickOursVersion(selectedConflictId) } } : {})}
            pickedSide={selectedConflictId ? (pickedSideById[selectedConflictId] ?? null) : null}
            {...(selectedConflictId ? { onUseServerVersion: () => { pickTheirsVersion(selectedConflictId) } } : {})}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12 }}>
          <Button secondary onClick={onClose} data-testid="git-conflict-resolution-cancel">
            {t('git.conflictCancel')}
          </Button>
          {/* Finishing is gated on every conflict having been decided:
            * with nothing pre-filled, an unvisited conflict has no answer
            * to publish. The tooltip says why rather than leaving a dead
            * button. */}
          <HeaderHoverTooltip
            label={t('git.conflictFinishBlocked')}
            suppressed={allResolved}
            placement="above"
            data-testid="git-conflict-resolution-finish-tooltip"
          >
            <Button
              onClick={onFinish}
              disabled={conflicts.length === 0 || !allResolved}
              data-testid="git-conflict-resolution-finish"
            >
              {t('git.conflictFinish')}
            </Button>
          </HeaderHoverTooltip>
        </div>
      </div>
    </Modal>
  )
}
