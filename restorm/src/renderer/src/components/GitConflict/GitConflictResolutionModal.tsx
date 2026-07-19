import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { conflicts, selectedConflictId, selectConflict, getResolvedEntity, pickOursVersion, pickTheirsVersion, onScenarioChange, quickConfigPicks, pickQuickConfigVersion, resolvedEpochById, pickedSideById, onResolvedEdited } = conflictResolution

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('git.conflictResolutionTitle')}
      data-testid="git-conflict-resolution-modal"
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
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <ConflictResolutionView
            conflicts={conflicts.map((conflict) => ({ id: conflict.id, label: conflict.name }))}
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
                    <ConflictEntityPanel entity={conflict.ours} mode="readOnly" activeTabId={effectiveTabId} onActiveTabChange={(tabId) => { setSharedTab({ conflictId: selectedConflictId, tabId }) }} {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
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
                    <ConflictEntityPanel entity={conflict.theirs} mode="readOnly" activeTabId={effectiveTabId} onActiveTabChange={(tabId) => { setSharedTab({ conflictId: selectedConflictId, tabId }) }} {...(activeFieldDiff ? { fieldDiff: activeFieldDiff } : {})} />
                  </div>
                </div>
              )
            }}
            renderResolvedPanel={(id) => {
              const conflict = conflicts.find((c) => c.id === id)
              const names = activeFieldDiff?.conflictingQuickConfigNames ?? []
              const resolved = getResolvedEntity(id)
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
                    onInputCapture={() => { onResolvedEdited(id) }}
                    onChangeCapture={() => { onResolvedEdited(id) }}
                  >
                    <ConflictEntityPanel
                      key={`${id}:${resolvedEpochById[id] ?? 0}`}
                      entity={resolved}
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
          <Button onClick={onFinish} disabled={conflicts.length === 0} data-testid="git-conflict-resolution-finish">
            {t('git.conflictFinish')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default GitConflictResolutionModal
