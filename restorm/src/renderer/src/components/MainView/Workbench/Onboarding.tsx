import React, { useMemo } from 'react'
import { MosaicLayout } from 'electron-core-ui/renderer'
import { ImportCard, RecentActivityCard, ApiCard, TipsCard } from './EmptyBenchCards'
import { isEnvironmentFolder, type EnvironmentFolder, type FolderItem } from '../../../../../shared/types/folderTypes'
import './EmptyBench.css'

/**
 * Onboarding — landing surface shown when a project is open but no workbench
 * tab is active (a fresh project, or after the user closes the last tab).
 * Composes the restorm-specific MosaicCard variants (`ImportCard`,
 * `RecentActivityCard`, `ApiCard`, `TipsCard`) into an ECUI `MosaicLayout` over
 * a faded Restorm logo.
 *
 * This component is purely presentational — WHEN it is shown is decided by the
 * caller (`App`), which holds it back until the workbench's tab restore has
 * settled so it never flashes during the async reopen on load. See
 * `loadWorkbenchTabIds` (ECUI) + the onboarding gate in `App`.
 *
 * Env-folder ApiCards are driven from the open project's `rootItems` passed in
 * from `App`. The card list reactively re-renders whenever the tree changes —
 * including env-folder + request renames — because `App` swaps `rootItems` by
 * reference on each mutation.
 */
interface OnboardingProps {
  /** The open project's full tree (env-folders, folders, and root
   *  requests). Onboarding filters env-folders for its ApiCards. */
  readonly rootItems: readonly FolderItem[]
  /** Project UUID stamped on the collection file. Scopes the favourites
   *  lookup in `ApiCard`. `null` until the file is hydrated. */
  readonly projectUuid: string | null
  /** Opens the import modal. Wired from `App` so the import card's CTA
   *  triggers the same flow as the title-bar menu / sidebar buttons. */
  readonly onImport: () => void
  /** Open a request in the workbench when its row is clicked in any
   *  of the card lists (favourites, top-played, last-played, recent
   *  activity). Wired to `useNavigation.handleItemClick` from `App`. */
  readonly onOpenRequest: (requestId: string) => void
}

export const Onboarding: React.FC<OnboardingProps> = ({ rootItems, projectUuid, onImport, onOpenRequest }) => {
  const envFolders = useMemo<EnvironmentFolder[]>(
    () => rootItems.filter(isEnvironmentFolder),
    [rootItems]
  )

  return (
    <div className="empty-bench-container">
      <img
        src="/imgs/logo_400.png"
        alt="Restorm"
        className="empty-bench-logo"
      />
      <MosaicLayout data-testid="empty-bench-mosaic">
        <ImportCard onImport={onImport} />
        <RecentActivityCard rootItems={rootItems} onOpenRequest={onOpenRequest} projectUuid={projectUuid} />
        {envFolders.map((folder) => (
          <ApiCard key={folder.id} folder={folder} projectUuid={projectUuid} onOpenRequest={onOpenRequest} />
        ))}
        <TipsCard />
      </MosaicLayout>
    </div>
  )
}

export default Onboarding
