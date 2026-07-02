import React from 'react'
import { useTranslation } from 'react-i18next'
import { SplitView, Pane } from '../Panes/SplitView'
import { ListView } from '../ListView'
import type { ListViewItemData, ListViewItemEventPayload } from '../ListView'
import { Button } from '../Button'

export interface ConflictListEntry {
  id: string
  label: string
}

export interface ConflictResolutionViewProps {
  /** Every conflicting entity in the pull. The list panel (leftmost) is
   * shown ONLY when there is more than one — a single conflict skips
   * straight to the 3 content panels. */
  conflicts: ConflictListEntry[]
  /** `null` before the user has picked one (only possible while the list
   * panel is showing, i.e. `conflicts.length > 1`). */
  selectedConflictId: string | null
  onSelectConflict: (id: string) => void
  /** Renders the user/ours panel content for the given conflict — the
   * host's EXACT normal entity panel, read-only. */
  renderUserPanel: (conflictId: string) => React.ReactNode
  /** Renders the server/theirs panel content — same panel, read-only. */
  renderServerPanel: (conflictId: string) => React.ReactNode
  /** Renders the resolved panel content — same panel, editable. */
  renderResolvedPanel: (conflictId: string) => React.ReactNode
  /** "Use this version" header action on the user panel — copying ALL of
   * its values into the resolved panel is the host's job (it owns the
   * entity state, e.g. by re-cloning `ours` into its resolved copy); this
   * shell only renders the button. Omit to hide the action. */
  onUseUserVersion?: () => void
  /** Same as `onUseUserVersion`, for the server panel. */
  onUseServerVersion?: () => void
  /** Test id root. Defaults to `conflict-resolution-view`. */
  'data-testid'?: string
}

/**
 * The generic 4-panel conflict-resolution shell: a master-detail conflict
 * LIST (only rendered when there's more than one conflict) driving three
 * side-by-side content panels — user/ours (read-only), server/theirs
 * (read-only), resolved (editable). This component owns none of the
 * entity-specific rendering: `renderUserPanel`/`renderServerPanel`/
 * `renderResolvedPanel` are host-injected (restorm plugs in its
 * entity→tab-view mapping — request/scenario/folder/environment-folder/…
 * — per `docs/Git/README.md`'s ECUI/restorm split). Selecting a
 * conflict-list row and the two "use this version" buttons are the only
 * interactions this component itself handles; everything else (field-
 * level diff highlighting, what "use this version" actually copies) is
 * the host's responsibility.
 */
export const ConflictResolutionView: React.FC<ConflictResolutionViewProps> = ({
  conflicts,
  selectedConflictId,
  onSelectConflict,
  renderUserPanel,
  renderServerPanel,
  renderResolvedPanel,
  onUseUserVersion,
  onUseServerVersion,
  'data-testid': dataTestId = 'conflict-resolution-view'
}) => {
  const { t } = useTranslation()
  const showList = conflicts.length > 1

  const listItems: ListViewItemData[] = conflicts.map((conflict) => ({ id: conflict.id, title: conflict.label }))

  const handleItemClick = (payload: ListViewItemEventPayload): void => {
    onSelectConflict(payload.item.id)
  }

  const useVersionAction = (onUse: (() => void) | undefined, testIdSuffix: string): React.ReactNode | undefined => {
    if (!onUse || !selectedConflictId) return undefined
    return (
      <Button
        small
        icon="check"
        options={{ ariaLabel: t('conflictResolution.useThisVersion') }}
        onClick={onUse}
        data-testid={`${dataTestId}-${testIdSuffix}`}
      />
    )
  }

  return (
    <div className="conflict-resolution-view" data-testid={dataTestId} style={{ width: '100%', height: '100%' }}>
      {/* `Pane` is a declarative marker only (renders null; `SplitView`
       * reads its children's props) — it has no `data-testid` of its own,
       * so per-panel testids live on the CONTENT below instead. */}
      <SplitView orientation="vertical" data-testid={`${dataTestId}-split`} style={{ width: '100%', height: '100%' }}>
        {showList && (
          <Pane title={t('conflictResolution.listTitle')} collapsible={false} minSize={180}>
            <ListView
              items={listItems}
              ariaLabel={t('conflictResolution.listTitle')}
              selectedIds={selectedConflictId ? [selectedConflictId] : []}
              onItemClick={handleItemClick}
              data-testid={`${dataTestId}-list`}
            />
          </Pane>
        )}
        <Pane
          title={t('conflictResolution.userTitle')}
          collapsible={false}
          minSize={240}
          alwaysShowHeaderActions
          headerActions={useVersionAction(onUseUserVersion, 'use-user-version')}
        >
          {selectedConflictId ? renderUserPanel(selectedConflictId) : (
            <EmptySelectionState dataTestId={`${dataTestId}-user-empty`} />
          )}
        </Pane>
        <Pane
          title={t('conflictResolution.serverTitle')}
          collapsible={false}
          minSize={240}
          alwaysShowHeaderActions
          headerActions={useVersionAction(onUseServerVersion, 'use-server-version')}
        >
          {selectedConflictId ? renderServerPanel(selectedConflictId) : (
            <EmptySelectionState dataTestId={`${dataTestId}-server-empty`} />
          )}
        </Pane>
        <Pane title={t('conflictResolution.resolvedTitle')} collapsible={false} minSize={240}>
          {selectedConflictId ? renderResolvedPanel(selectedConflictId) : (
            <EmptySelectionState dataTestId={`${dataTestId}-resolved-empty`} />
          )}
        </Pane>
      </SplitView>
    </div>
  )
}

const EmptySelectionState: React.FC<{ dataTestId: string }> = ({ dataTestId }) => {
  const { t } = useTranslation()
  return (
    <div
      data-testid={dataTestId}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--descriptionForeground)' }}
    >
      {t('conflictResolution.selectAConflict')}
    </div>
  )
}

export default ConflictResolutionView
