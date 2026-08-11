import React, { useMemo, useState } from 'react'
import { MosaicLayout, ScrollableElement } from 'electron-core-ui/renderer'
import { ImportCard, RecentActivityCard, ApiCard, TipsCard, TIP_COUNT } from './EmptyBenchCards'
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

/** When the board would otherwise be near-empty (no imported service, hence no
 *  ApiCard and no recent activity), we pad it with several tip cards so the
 *  onboarding surface stays full — at least this many tip blocks. */
const EMPTY_BOARD_MIN_TIPS = 4

/** Pick `count` distinct random tip indices (≤ the number of tips). Kept as a
 *  module function so the randomness lives outside React's render (used from a
 *  lazy `useState` initializer). */
function pickDistinctTipSeeds(count: number): number[] {
  const target = Math.min(count, TIP_COUNT)
  const seeds: number[] = []
  const used = new Set<number>()
  while (seeds.length < target) {
    const r = Math.floor(Math.random() * TIP_COUNT)
    if (!used.has(r)) {
      used.add(r)
      seeds.push(r)
    }
  }
  return seeds
}

export const Onboarding: React.FC<OnboardingProps> = ({ rootItems, projectUuid, onImport, onOpenRequest }) => {
  const envFolders = useMemo<EnvironmentFolder[]>(
    () => rootItems.filter(isEnvironmentFolder),
    [rootItems]
  )

  // No imported service → no ApiCard, and recent activity only tracks items in
  // the tree, so an empty project's board would show just Import + one tip.
  // Fill it with several tip cards, each seeded to a distinct starting tip.
  const isEmptyBoard = envFolders.length === 0
  const [tipSeeds] = useState<number[]>(() => pickDistinctTipSeeds(EMPTY_BOARD_MIN_TIPS))

  return (
    // The outer wrapper fills the workbench's empty slot (a flex column) but
    // does NOT scroll itself — the themed ECUI `ScrollableElement` owns the
    // scroll so overflow shows the app-consistent scrollbar instead of the
    // native OS one. `flex:1; minHeight:0` on the ScrollableElement gives it a
    // definite measured height, so its inner `height:100%` content resolves and
    // scrolls; the visual padding/centering lives on the inner content wrapper
    // so the scrollbar sits at the panel edge.
    <div className="empty-bench-container">
      <ScrollableElement
        data-testid="empty-bench-scroll"
        style={{ flex: 1, minHeight: 0 }}
      >
        <div className="empty-bench-scroll-inner">
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
            {isEmptyBoard
              ? tipSeeds.map((seed) => <TipsCard key={`tips-${seed}`} initialIndex={seed} />)
              : <TipsCard />}
          </MosaicLayout>
        </div>
      </ScrollableElement>
    </div>
  )
}
