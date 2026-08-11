import React from 'react'
import { Toggle } from 'electron-core-ui/renderer'
import { Badge } from '../../../common/Badge'
import { mapToBadgeType } from '../../../../utils/badgeUtils'

/**
 * `RequestListRow` — single-row content shared by every EmptyBench
 * list (favourites, top-played, last-played, cross-API recent
 * activity) and the env-folder home favourites table.
 *
 * Visual:
 *
 *   [method badge]  request-name   [optional trailing]   [⭐ toggle]
 *
 * The whole row is clickable — clicking anywhere outside the star
 * fires `onOpen` (opens the request tab). The star is an ECUI
 * `Toggle` with `appearance="star"`; clicking it flips the favourite
 * state via `onToggleFavorite` and the row click is suppressed so
 * the user doesn't accidentally open a tab while (un)faving.
 */

export interface RequestListRowProps {
  id: string
  name: string
  /** Protocol method (e.g. "GET", "POST", "GRAPHQL"). Mapped to a
   *  Badge variant via `mapToBadgeType`. */
  method: string
  /** True when this request is in the user's favourites for the
   *  current project. Drives the star Toggle's checked state. */
  isFavorite: boolean
  /** Open the request's workbench tab. Fires on click anywhere
   *  outside the star toggle. */
  onOpen: () => void
  /** Toggle the favourite state. Receives the *next* state. */
  onToggleFavorite: (next: boolean) => void
  /** Optional right-aligned content rendered between the name and
   *  the star (e.g. a usage count, the parent API name). */
  trailing?: React.ReactNode
  'data-testid'?: string
}

export const RequestListRow: React.FC<RequestListRowProps> = ({
  id,
  name,
  method,
  isFavorite,
  onOpen,
  onToggleFavorite,
  trailing,
  'data-testid': dataTestId
}) => {
  return (
    <div
      className="request-list-row"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      data-testid={dataTestId ?? `request-list-row-${id}`}
    >
      <Badge type={mapToBadgeType(method)} />
      <span className="request-list-row__name">{name}</span>
      {trailing !== undefined && trailing !== null ? (
        <span className="request-list-row__trailing">{trailing}</span>
      ) : null}
      <span
        className="request-list-row__star"
        onClick={(e) => { e.stopPropagation() }}
      >
        <Toggle
          appearance="star"
          checked={isFavorite}
          onChange={(next) => { onToggleFavorite(next) }}
          data-testid={`${dataTestId ?? `request-list-row-${id}`}-star`}
        />
      </span>
    </div>
  )
}
