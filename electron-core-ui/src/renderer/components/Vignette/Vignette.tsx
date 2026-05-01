import React, { useState } from 'react'
import {
  BorderBeam,
  MagicCard,
  ShineBorder,
  pickRandomBorderBeamProps,
  pickRandomMagicCardProps,
  pickRandomShineBorderProps,
  pickRandomVignetteDecoration,
  type VignetteDecorationId
} from './decorations'
import './vignette.css'

export type VignetteDecoration = VignetteDecorationId | 'random'

export interface VignetteProps {
  /** Built-in decoration applied to the frame. Pass `'random'` to pick at mount. */
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
  const [resolved] = useState<{ id: VignetteDecorationId; element: React.ReactElement } | null>(() => {
    if (!decoration) return null
    const id: VignetteDecorationId =
      decoration === 'random' ? pickRandomVignetteDecoration() : decoration
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

const DECORATION_BUILDERS: Record<VignetteDecorationId, () => React.ReactElement> = {
  'border-beam': () => <BorderBeam {...pickRandomBorderBeamProps()} />,
  'shine-border': () => <ShineBorder {...pickRandomShineBorderProps()} />,
  'magic-card': () => <MagicCard {...pickRandomMagicCardProps()} />
}

function buildDecorationElement(id: VignetteDecorationId): React.ReactElement {
  return DECORATION_BUILDERS[id]()
}

export default Vignette
