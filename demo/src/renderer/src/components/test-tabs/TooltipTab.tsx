import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from 'electron-core-ui/renderer'
import type { TooltipProps } from 'electron-core-ui/renderer'

type Placement = NonNullable<TooltipProps['placement']>
type Side = NonNullable<TooltipProps['side']>

const TooltipTab: React.FC = () => {
  const { t } = useTranslation()

  const targetARef = useRef<HTMLDivElement | null>(null)
  const targetBRef = useRef<HTMLDivElement | null>(null)

  const [activeTarget, setActiveTarget] = useState<'A' | 'B'>('A')
  const [show, setShow] = useState(false)
  const [placement, setPlacement] = useState<Placement>('auto')
  const [side, setSide] = useState<Side>('auto')
  const [useFixedTop, setUseFixedTop] = useState(false)
  const [fixedTopValue, setFixedTopValue] = useState(120)
  const [repositionKey, setRepositionKey] = useState(0)
  const [lastPosition, setLastPosition] = useState('')

  const targetRef = useMemo<React.RefObject<HTMLElement | null>>(() => {
    return activeTarget === 'A' ? (targetARef as React.RefObject<HTMLElement | null>) : (targetBRef as React.RefObject<HTMLElement | null>)
  }, [activeTarget])

  useEffect(() => {
    if (!show) return
    const id = window.setInterval(() => {
      const el = document.querySelector('[data-testid="tooltip-basic"]')
      if (!el) return
      const top = el.getAttribute('data-top') ?? ''
      const left = el.getAttribute('data-left') ?? ''
      const dp = el.getAttribute('data-placement') ?? ''
      const ds = el.getAttribute('data-side') ?? ''
      const positioned = el.getAttribute('data-is-positioned') ?? ''
      setLastPosition(`positioned=${positioned}; top=${top}; left=${left}; placement=${dp}; side=${ds}`)
    }, 50)
    return () => { window.clearInterval(id) }
  }, [show])

  return (
    <div style={{ padding: 20, minHeight: 600 }}>
      <div style={{ display: 'grid', gap: 10, maxWidth: 900 }}>
        <h3 style={{ margin: 0 }}>{t('tooltip.harness.title')}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 8, fontSize: 13 }}>
          <div>{t('tooltip.harness.ready')}</div>
          <div data-testid="tooltip-ready">true</div>

          <div>{t('tooltip.harness.activeTarget')}</div>
          <div data-testid="tooltip-active-target">{activeTarget}</div>

          <div>{t('tooltip.harness.lastPosition')}</div>
          <div data-testid="tooltip-last-position">{show ? lastPosition : ''}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button data-testid="tooltip-toggle-show" onClick={() => { setShow((s) => !s) }}>
            {show ? t('tooltip.harness.hide') : t('tooltip.harness.show')}
          </button>

          <button data-testid="tooltip-switch-target" onClick={() => { setActiveTarget((v) => (v === 'A' ? 'B' : 'A')) }}>
            {t('tooltip.harness.switchTarget')}
          </button>

          <button data-testid="tooltip-bump-reposition-key" onClick={() => { setRepositionKey((k) => k + 1) }}>
            {t('tooltip.harness.bumpRepositionKey')}
          </button>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>{t('tooltip.harness.placement')}</span>
            <select
              data-testid="tooltip-placement"
              value={placement}
              onChange={(e) => { setPlacement(e.target.value as Placement) }}
            >
              <option value="auto">auto</option>
              <option value="above">above</option>
              <option value="below">below</option>
            </select>
          </label>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>{t('tooltip.harness.side')}</span>
            <select
              data-testid="tooltip-side"
              value={side}
              onChange={(e) => { setSide(e.target.value as Side) }}
            >
              <option value="auto">auto</option>
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          </label>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              data-testid="tooltip-fixed-top-enabled"
              type="checkbox"
              checked={useFixedTop}
              onChange={() => { setUseFixedTop((v) => !v) }}
            />
            <span>{t('tooltip.harness.fixedTop')}</span>
          </label>

          <input
            data-testid="tooltip-fixed-top-value"
            type="number"
            value={fixedTopValue}
            onChange={(e) => { setFixedTopValue(Number(e.target.value)) }}
            disabled={!useFixedTop}
            style={{ width: 90 }}
          />
        </div>
      </div>

      {/* Targets are fixed to force consistent placement behavior */}
      <div
        ref={targetARef}
        data-testid="tooltip-target-a"
        style={{
          position: 'fixed',
          top: 20,
          left: 400,
          width: 140,
          height: 28,
          backgroundColor: 'var(--button-secondaryBackground)',
          border: '1px solid var(--button-border)',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12
        }}
      >
        {t('tooltip.harness.targetA')}
      </div>

      <div
        ref={targetBRef}
        data-testid="tooltip-target-b"
        style={{
          position: 'fixed',
          bottom: 20,
          left: 400,
          width: 140,
          height: 28,
          backgroundColor: 'var(--button-secondaryBackground)',
          border: '1px solid var(--button-border)',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12
        }}
      >
        {t('tooltip.harness.targetB')}
      </div>

      <Tooltip
        data-testid="tooltip-basic"
        targetRef={targetRef}
        show={show}
        placement={placement}
        side={side}
        {...(useFixedTop ? { fixedTop: fixedTopValue } : {})}
        repositionKey={repositionKey}
        content={(
          <div style={{ padding: 8 }}>
            <div style={{ fontSize: 12 }}>{t('tooltip.harness.tooltipContent')}</div>
          </div>
        )}
      />
    </div>
  )
}

export default TooltipTab
