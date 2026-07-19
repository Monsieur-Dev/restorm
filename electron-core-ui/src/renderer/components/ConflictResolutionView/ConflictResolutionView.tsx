import React from 'react'
import { useTranslation } from 'react-i18next'
import { ListView } from '../ListView'
import type { ListViewItemData, ListViewItemEventPayload } from '../ListView'
import { Button } from '../Button'
import './conflictResolutionView.css'

export interface ConflictListEntry {
  id: string
  label: string
}

export interface ConflictResolutionViewProps {
  /** Every conflicting entity in the pull. The list column (leftmost) is
   * shown ONLY when there is more than one — a single conflict skips
   * straight to the 3 content columns. */
  conflicts: ConflictListEntry[]
  /** `null` before the user has picked one (only possible while the list
   * column is showing, i.e. `conflicts.length > 1`). */
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
  /** Which side the resolved copy currently mirrors — paints that column's
   * "use this version" check green. Cleared (null/undefined) once the
   * resolved copy is hand-edited. */
  pickedSide?: 'user' | 'server' | null
  /** Test id root. Defaults to `conflict-resolution-view`. */
  'data-testid'?: string
}

/**
 * The generic conflict-resolution shell: an optional master-detail conflict
 * LIST (only rendered when there's more than one conflict) followed by three
 * side-by-side content columns — user/ours (read-only), server/theirs
 * (read-only), resolved (editable). Laying the versions out as COLUMNS lets
 * the user compare them at a glance; each column scrolls independently of its
 * neighbours (the injected panels fill height and scroll via their own ECUI
 * scrollables). This component owns none of the entity-specific rendering:
 * `renderUserPanel`/`renderServerPanel`/`renderResolvedPanel` are host-injected
 * (restorm plugs in its entity→tab-view mapping — request/scenario/folder/
 * environment-folder/… — per `docs/Git/README.md`'s ECUI/restorm split).
 * Selecting a conflict-list row and the two "use this version" buttons are the
 * only interactions this component itself handles; everything else (field-
 * level diff highlighting, what "use this version" actually copies) is the
 * host's responsibility.
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
  pickedSide = null,
  'data-testid': dataTestId = 'conflict-resolution-view'
}) => {
  const { t } = useTranslation()
  const showList = conflicts.length > 1

  const listItems: ListViewItemData[] = conflicts.map((conflict) => ({ id: conflict.id, title: conflict.label }))

  const handleItemClick = (payload: ListViewItemEventPayload): void => {
    onSelectConflict(payload.item.id)
  }

  const useVersionAction = (onUse: (() => void) | undefined, testIdSuffix: string, picked: boolean): React.ReactNode | undefined => {
    if (!onUse || !selectedConflictId) return undefined
    return (
      <span className={picked ? 'conflict-resolution-use-action picked' : 'conflict-resolution-use-action'} data-picked={picked || undefined}>
        <Button
          small
          icon="check"
          options={{ ariaLabel: t('conflictResolution.useThisVersion') }}
          onClick={onUse}
          data-testid={`${dataTestId}-${testIdSuffix}`}
        />
      </span>
    )
  }

  const renderVersionColumn = (
    side: 'user' | 'server' | 'resolved',
    title: string,
    renderPanel: (conflictId: string) => React.ReactNode,
    action?: React.ReactNode
  ): React.ReactNode => (
    <div
      className="conflict-resolution-column conflict-resolution-column--version"
      data-testid={`${dataTestId}-panel-${side}`}
    >
      <div className="conflict-resolution-column-header">
        <span className="conflict-resolution-column-title">{title}</span>
        {action ? <div className="conflict-resolution-column-actions">{action}</div> : null}
      </div>
      <div className="conflict-resolution-column-body">
        {selectedConflictId ? renderPanel(selectedConflictId) : (
          <EmptySelectionState dataTestId={`${dataTestId}-${side}-empty`} />
        )}
      </div>
    </div>
  )

  return (
    <div className="conflict-resolution-view" data-testid={dataTestId} style={{ width: '100%', height: '100%' }}>
      <div className="conflict-resolution-view-columns" data-testid={`${dataTestId}-columns`}>
        {showList && (
          <div className="conflict-resolution-column conflict-resolution-column--list" data-testid={`${dataTestId}-panel-list`}>
            <div className="conflict-resolution-column-header">
              <span className="conflict-resolution-column-title">{t('conflictResolution.listTitle')}</span>
            </div>
            <div className="conflict-resolution-column-body">
              <ListView
                items={listItems}
                ariaLabel={t('conflictResolution.listTitle')}
                selectedIds={selectedConflictId ? [selectedConflictId] : []}
                onItemClick={handleItemClick}
                data-testid={`${dataTestId}-list`}
              />
            </div>
          </div>
        )}
        {renderVersionColumn(
          'user',
          t('conflictResolution.userTitle'),
          renderUserPanel,
          useVersionAction(onUseUserVersion, 'use-user-version', pickedSide === 'user')
        )}
        {renderVersionColumn(
          'server',
          t('conflictResolution.serverTitle'),
          renderServerPanel,
          useVersionAction(onUseServerVersion, 'use-server-version', pickedSide === 'server')
        )}
        {renderVersionColumn(
          'resolved',
          t('conflictResolution.resolvedTitle'),
          renderResolvedPanel
        )}
      </div>
    </div>
  )
}

const EmptySelectionState: React.FC<{ dataTestId: string }> = ({ dataTestId }) => {
  const { t } = useTranslation()
  return (
    <div className="conflict-resolution-view-empty" data-testid={dataTestId}>
      {t('conflictResolution.selectAConflict')}
    </div>
  )
}

export default ConflictResolutionView
