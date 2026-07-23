import React, { useLayoutEffect, useRef } from 'react'
import { Button, IconView } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import { BeamWrap } from './BeamWrap'
import { SendButtonEnvSwitcher } from '../RequestTabViews/SendButtonEnvSwitcher'
import './roundActionButton.css'

/** Which of the shape's two diameters to use. `primary` is the main action,
 * `secondary` its smaller companion. */
export type RoundActionButtonSize = 'primary' | 'secondary'

/** Disc colour when the caller has none of its own. `run` is the green "go"
 * disc, `stop` the red one, `neutral` the grey inactive one — the same
 * `--scenario-action-*` tokens the scenario toolbar uses. */
export type RoundActionButtonTone = 'run' | 'stop' | 'neutral'

export interface RoundActionButtonProps {
  /** Codicon name. Icon only — a round action button never carries a label. */
  icon: string
  onClick?: (() => void) | undefined
  disabled?: boolean | undefined
  /** Accessible name. These discs carry NO hover tooltip by explicit design
   * decision, so this is the only name they expose — it is required. */
  ariaLabel: string
  size?: RoundActionButtonSize | undefined
  tone?: RoundActionButtonTone | undefined
  /** Active environment colour. Wins over `tone`; the shape derives the glyph's
   * own colour from it so a pale environment stays readable. */
  color?: string | undefined
  /** Active environment icon, shown as the disc's corner badge. */
  envIcon?: Icon | undefined
  /** Runs the orbiting beam around the disc. */
  beamActive?: boolean | undefined
  /** Exposes the right-click environment picker. Off by default: server-mode
   * actions ignore environments and deliberately have no picker. */
  envSwitch?: boolean | undefined
  className?: string | undefined
  'data-testid'?: string | undefined
}

/** Beam trail length, ring thickness, and the single yellow it runs. */
const BEAM_TRAIL_PX = 51
const BEAM_RING_PX = 3.75
const BEAM_COLOR = '#facc15'

const ENV_BADGE_SIZE_PX: Record<RoundActionButtonSize, number> = {
  primary: 15,
  secondary: 12
}

/**
 * The beam orbits the MIDDLE of the disc's ring, so its radius is a function of
 * the shape's geometry — which belongs to the library. Rather than restate the
 * numbers here (they would drift the moment the shape is retuned), read the
 * public custom properties the shape exposes and hand the derived radius to the
 * beam host as a property of its own.
 *
 * Written straight to the node rather than held in state: this is a value the
 * DOM needs, not one React renders from, and routing it through state would
 * cost an extra render for a number that never reaches the JSX.
 */
const useBeamOrbitRadius = (hostRef: React.RefObject<HTMLElement | null>, size: RoundActionButtonSize): void => {
  useLayoutEffect(() => {
    const host = hostRef.current
    const disc = host?.querySelector('.appearance-round')
    const beam = host?.closest<HTMLElement>('.restorm-round-action-beam')
    if (!disc || !beam) return
    const cs = window.getComputedStyle(disc)
    const diameter = Number.parseFloat(cs.getPropertyValue('--ecui-round-diameter'))
    const ring = Number.parseFloat(cs.getPropertyValue('--ecui-round-ring'))
    if (!Number.isFinite(diameter) || !Number.isFinite(ring)) return
    beam.style.setProperty('--restorm-round-action-orbit', `${diameter / 2 - ring / 2}px`)
  }, [hostRef, size])
}

/**
 * Round action disc for a request tab: the ECUI round button, plus the two
 * things the library has no business knowing about — the orbiting beam that
 * marks a call in flight, and the right-click environment picker.
 *
 * The beam wrapper sits OUTSIDE everything a caller may swap, and the picker is
 * always mounted (inert when it does not apply), so flipping between states
 * never remounts the disc and never cuts a running beam mid-lap.
 */
export const RoundActionButton: React.FC<RoundActionButtonProps> = ({
  icon,
  onClick,
  disabled = false,
  ariaLabel,
  size = 'primary',
  tone = 'run',
  color,
  envIcon,
  beamActive = false,
  envSwitch = false,
  className,
  'data-testid': dataTestId
}) => {
  const hostRef = useRef<HTMLSpanElement>(null)
  useBeamOrbitRadius(hostRef, size)

  const discClassName = [
    'restorm-round-action-button',
    color ? undefined : `restorm-round-action-tone-${tone}`,
    className
  ].filter(Boolean).join(' ')

  return (
    <BeamWrap
      active={beamActive}
      size={BEAM_TRAIL_PX}
      borderWidth={BEAM_RING_PX}
      colorFrom={BEAM_COLOR}
      colorTo={BEAM_COLOR}
      className="restorm-round-action-beam"
    >
      {/* Always mounted, inert when the picker does not apply: swapping this
        * element would remount the disc and cut a running beam mid-lap. */}
      <SendButtonEnvSwitcher enabled={envSwitch}>
        <span ref={hostRef} className="restorm-round-action">
          <Button
            appearance="round"
            {...(size === 'secondary' ? { small: true } : {})}
            icon={icon}
            {...(onClick ? { onClick } : {})}
            disabled={disabled}
            className={discClassName}
            {...(color ? { backgroundColor: color } : {})}
            {...(envIcon && envIcon.type !== 'none'
              ? { cornerBadge: <IconView icon={envIcon} size={ENV_BADGE_SIZE_PX[size]} /> }
              : {})}
            options={{ ariaLabel }}
            {...(dataTestId ? { 'data-testid': dataTestId } : {})}
          />
        </span>
      </SendButtonEnvSwitcher>
    </BeamWrap>
  )
}

export default RoundActionButton
