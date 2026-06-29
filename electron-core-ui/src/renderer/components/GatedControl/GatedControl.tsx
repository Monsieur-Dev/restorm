import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '../Tooltip'
import { Button } from '../Button'
import './gatedControl.css'

export interface GatedControlProps {
  /**
   * When true the wrapped control is locked: rendered greyed + non-interactive,
   * with a hover info-bulle offering the upsell. When false the children are
   * rendered untouched (the primitive is fully transparent), so a single call
   * site can flip between the free and entitled states without branching.
   */
  locked: boolean
  /** The control(s) to gate — a Button, a control group, etc. */
  children: React.ReactNode
  /**
   * Invoked when the user clicks « S'abonner » in the locked-state tooltip. The
   * primitive stays presentation-only: the host wires this to its checkout flow.
   */
  onSubscribe?: () => void
  /** Heading shown in the locked tooltip. Defaults to the translated « Version Pro ». */
  proLabel?: string
  /** Upsell link label. Defaults to the translated « S'abonner ». */
  subscribeLabel?: string
  /** Extra class on the inline-flex anchor wrapper. */
  className?: string
  /** Vertical placement of the upsell tooltip (default below). */
  placement?: 'auto' | 'above' | 'below'
  'data-testid'?: string
}

/**
 * GatedControl — the single « visible mais verrouillé » gating primitive.
 *
 * A capability-gated control stays VISIBLE but, when the entitlement is absent,
 * is shown disabled (greyed) and intercepts pointer input so the wrapped control
 * can never fire. Hovering reveals one ECUI `Tooltip` carrying the « Version Pro »
 * label + a « S'abonner » link — the one place the upsell is themed + translated,
 * so no feature has to hand-roll its own grisage. When `locked` is false the
 * children render exactly as-is.
 */
export const GatedControl: React.FC<GatedControlProps> = ({
  locked,
  children,
  onSubscribe,
  proLabel,
  subscribeLabel,
  className,
  placement = 'below',
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  // A short close delay bridges the gap between the anchor and the portaled
  // tooltip so the pointer can travel onto the « S'abonner » link without the
  // tooltip closing under it.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const open = useCallback((): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setHover(true)
  }, [])

  const scheduleClose = useCallback((): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setHover(false) }, 120)
  }, [])

  // Transparent passthrough when entitled — no extra DOM, no behaviour change.
  if (!locked) return <>{children}</>

  const resolvedProLabel = proLabel ?? t('gatedControl.proLabel', 'Version Pro')
  const resolvedSubscribeLabel = subscribeLabel ?? t('gatedControl.subscribe', "S'abonner")

  return (
    <span
      ref={anchorRef}
      className={className ? `ecu-gated ${className}` : 'ecu-gated'}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      data-gated="true"
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
    >
      {/* The locked control: visually greyed and pointer-inert so neither its
       * click nor its own hover tooltip can fire while gated. `aria-hidden` is
       * deliberately NOT set — the control stays in the a11y tree as disabled. */}
      <span className="ecu-gated-child" aria-disabled="true">
        {children}
      </span>
      <Tooltip
        targetRef={anchorRef}
        show={hover}
        placement={placement}
        className="ecu-gated-tooltip"
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        {...(dataTestId ? { 'data-testid': `${dataTestId}-upsell` } : {})}
        content={
          <span className="ecu-gated-upsell">
            <span className="ecu-gated-upsell-pro">
              <i className="codicon codicon-lock" aria-hidden="true" />
              {resolvedProLabel}
            </span>
            <Button
              externalLink
              onClick={() => { onSubscribe?.() }}
              className="ecu-gated-upsell-link"
              {...(dataTestId ? { 'data-testid': `${dataTestId}-subscribe` } : {})}
            >
              {resolvedSubscribeLabel}
            </Button>
          </span>
        }
      />
    </span>
  )
}

export default GatedControl
