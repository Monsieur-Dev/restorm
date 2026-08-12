import React, { useState } from 'react'
import {
  BorderBeam,
  ElectricBorder,
  MagicCard,
  ShineBorder,
  pickRandomBorderBeamProps,
  pickRandomElectricBorderProps,
  pickRandomMagicCardProps,
  pickRandomShineBorderProps,
  pickRandomBorderEffect,
  type BorderEffectId
} from '../../effects/border'
import './vignette.css'

export type VignetteDecoration = BorderEffectId | 'random'

export interface VignetteProps {
  /** Border effect applied to the frame. Pass `'random'` to pick at mount. */
  decoration?: VignetteDecoration
  /** Content rendered inside the frame. */
  children?: React.ReactNode
  /** Optional className appended to the root for custom styling. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id for stable E2E selectors. */
  'data-testid'?: string
}

export const Vignette = React.forwardRef<HTMLDivElement, VignetteProps>(function Vignette(
  { decoration, children, className, style, 'data-testid': dataTestId },
  ref
) {
  const [resolved] = useState<{ id: BorderEffectId; element: React.ReactElement } | null>(() => {
    if (!decoration) return null
    const id: BorderEffectId =
      decoration === 'random'
        // Keep `electric-border` out of the routine-vignette pool —
        // the turbulence-displaced wobble is a high-impact "feature
        // moment" effect and would lose its punch if every casual
        // `decoration="random"` rolled it. Consumers that want the
        // electric look can still opt in explicitly via
        // `decoration="electric-border"`.
        ? pickRandomBorderEffect({ exclude: ['electric-border'] })
        : decoration
    return { id, element: buildDecorationElement(id) }
  })

  const classes = ['ecu-vignette', className].filter(Boolean).join(' ')
  const dataAttrs = resolved ? { 'data-decoration': resolved.id } : {}

  return (
    <div ref={ref} className={classes} style={style} data-testid={dataTestId} {...dataAttrs}>
      <div className="ecu-vignette-content">{children}</div>
      {resolved?.element ?? null}
    </div>
  )
})

const DECORATION_BUILDERS: Record<BorderEffectId, () => React.ReactElement> = {
  'border-beam': () => <BorderBeam {...pickRandomBorderBeamProps()} />,
  'shine-border': () => <ShineBorder {...pickRandomShineBorderProps()} />,
  'magic-card': () => <MagicCard {...pickRandomMagicCardProps()} />,
  'electric-border': () => <ElectricBorder {...pickRandomElectricBorderProps()} />
}

function buildDecorationElement(id: BorderEffectId): React.ReactElement {
  return DECORATION_BUILDERS[id]()
}
