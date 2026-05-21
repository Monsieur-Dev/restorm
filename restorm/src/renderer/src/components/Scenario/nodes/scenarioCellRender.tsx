import { type ReactNode } from 'react'
import type { ScenarioPortRole } from '../../../../../shared/types/collections'
import { ROLE_COLOR } from '../scenarioGraphMapping'
import type { ScenarioNodeCell } from './ScenarioNodeBoxBase'
import { ScenarioCellLabel } from './ScenarioCellLabel'

const NEUTRAL_ANCHOR = '#9ca3af'

/** Colour for a port anchor by its role (neutral grey when unspecified). */
export function anchorColor(role?: ScenarioPortRole): string {
  return role ? ROLE_COLOR[role] ?? NEUTRAL_ANCHOR : NEUTRAL_ANCHOR
}

/** Render a cell's body: explicit `content`, a `name ↔ value` KV pair, or a plain label. */
export function cellBody(cell: ScenarioNodeCell): ReactNode {
  if (cell.content !== undefined) return cell.content
  if (cell.value !== undefined) {
    return (
      <span className="scn-kv">
        <ScenarioCellLabel cell={cell} />
        <span className="scn-kv-value">{cell.value}</span>
      </span>
    )
  }
  if (cell.label !== undefined) return <ScenarioCellLabel cell={cell} />
  return null
}
