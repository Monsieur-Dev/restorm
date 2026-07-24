import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '../Tooltip'
import './custom-wco.css'

export interface CustomWCOProps {
  className?: string
  platform?: string
  /** Optional test id applied to the root element. */
  'data-testid'?: string
  /**
   * Show the styled hover tooltip (Minimize / Maximize / Restore / Close) on the
   * window-control buttons. Default `true`. Set `false` to hide it — the buttons
   * keep their `aria-label` for a11y and never fall back to the native `title`;
   * the icons are self-explanatory. (Restorm opts out via the Titlebar's
   * `customWcoHoverTooltips`.)
   */
  hoverTooltips?: boolean
}

// Extend Navigator type for windowControlsOverlay API
interface WindowControlsOverlay {
  visible: boolean
  getTitlebarAreaRect: () => DOMRect
}

interface NavigatorWithWCO extends Navigator {
  windowControlsOverlay?: WindowControlsOverlay
}

/**
 * Rendered width of the Linux WCO button row: 3 × 30px buttons +
 * 2px right padding from `.window-controls-container`. Kept as a
 * single source of truth so the on-page `.custom-wco` placeholder
 * (sized via `width: var(--wco-width, 92px)` in `custom-wco.css`)
 * stays in sync with the value this component pushes onto
 * `document.body` for downstream consumers (e.g. the Modal drag
 * strip's right offset).
 */
const LINUX_WCO_WIDTH_PX = 92

const CustomWCO: React.FC<CustomWCOProps> = ({
  className = '',
  platform,
  'data-testid': dataTestId,
  hoverTooltips = true
}) => {
  const { t } = useTranslation()
  // Track async platform detection separately
  const [asyncPlatform, setAsyncPlatform] = useState<string>('')
  const [isMaximized, setIsMaximized] = useState(false)
  const [wcoWidth, setWcoWidth] = useState<number>(138) // Default Windows WCO width
  const [hoveredWco, setHoveredWco] = useState<string | null>(null)
  const wcoTooltipRef = useRef<HTMLElement | null>(null)

  // Effective platform: use prop if provided, otherwise async-detected
  const currentPlatform = platform ?? asyncPlatform

  useEffect(() => {
    // Get platform from electronAPI if not provided as prop. Capture the
    // disposer and remove the listener on cleanup so a remount doesn't stack
    // duplicate 'platform' subscriptions.
    if (!platform && window.electronAPI?.onPlatform) {
      const dispose = window.electronAPI.onPlatform((detectedPlatform: string) => {
        setAsyncPlatform(detectedPlatform)
      })
      return dispose
    }
    return undefined
  }, [platform])

  useEffect(() => {
    // Listen for window state changes; remove the listener on cleanup.
    if (window.electronAPI?.onWindowState) {
      const dispose = window.electronAPI.onWindowState((state: string) => {
        setIsMaximized(state === 'maximized')
      })
      return dispose
    }
    return undefined
  }, [])

  // Calculate WCO width from native API if available
  useEffect(() => {
    const nav = navigator as NavigatorWithWCO
    if (!nav.windowControlsOverlay?.visible) {
      return
    }

    const updateWcoWidth = (): void => {
      const rect = nav.windowControlsOverlay?.getTitlebarAreaRect()
      if (rect) {
        // WCO width = window width - titlebar area width - titlebar area x
        const controlsWidth = window.innerWidth - rect.width - rect.x
        if (controlsWidth > 0) {
          setWcoWidth(controlsWidth)
        }
      }
    }

    updateWcoWidth()
    window.addEventListener('resize', updateWcoWidth)
    return () => { window.removeEventListener('resize', updateWcoWidth) }
  }, [currentPlatform])

  // Expose the rendered WCO width on `document.body` as `--wco-width`
  // so other components (the Modal drag strip, the on-page `.custom-wco`
  // placeholder) can leave a matching gap for the controls. The effect
  // is declared above the platform-branched returns below; React still
  // commits all hooks for the renders that exit through those returns,
  // so the var is set on every platform.
  useEffect(() => {
    if (typeof document === 'undefined') return
    let width = 0
    if (currentPlatform === 'linux') width = LINUX_WCO_WIDTH_PX
    // macOS draws its window controls on the LEFT, so nothing is reserved on
    // the right here — the title bar reserves a left inset instead. Reserving
    // the Windows width on darwin left a dead gap after the right-hand actions
    // and pushed the centre zone off-centre.
    else if (currentPlatform === 'win32') width = wcoWidth
    document.body.style.setProperty('--wco-width', `${width}px`)
    return () => {
      document.body.style.removeProperty('--wco-width')
    }
  }, [currentPlatform, wcoWidth])

  const handleMinimize = (): void => {
    if (window.electronAPI?.sendAction) {
      window.electronAPI.sendAction('minimize')
    }
  }

  const handleMaximize = (): void => {
    if (window.electronAPI?.sendAction) {
      window.electronAPI.sendAction('maximize')
    }
  }

  const handleClose = (): void => {
    if (window.electronAPI?.sendAction) {
      window.electronAPI.sendAction('close')
    }
  }

  // macOS: the native traffic lights sit top-LEFT, so there is nothing to
  // reserve on the right. The title bar insets its left zone instead.
  if (currentPlatform === 'darwin') {
    return null
  }

  // On Windows, return a spacer div to reserve space for the native WCO
  if (currentPlatform === 'win32') {
    return (
      <div 
        className={`custom-wco-spacer ${className}`}
        style={{ 
          width: wcoWidth, 
          height: '100%',
          flexShrink: 0
        }}
        {...(dataTestId && { 'data-testid': dataTestId })}
      />
    )
  }

  // On other platforms (not Linux), return null
  if (currentPlatform !== 'linux') {
    return null
  }

  // The button row is portalled to `document.body` so it escapes any
  // ancestor stacking context the host app might have on its main
  // layout (commonly created by `position: relative + z-index` on a
  // workbench root). Without the portal, the buttons stay trapped
  // under a Modal overlay even with a high `z-index` because the
  // overlay's stacking context wins against the constrained host
  // ancestor. The on-page `.custom-wco` placeholder still occupies
  // the title bar's grid cell so layout doesn't shift.
  const minimizeLabel = t('customWco.minimize', 'Minimize')
  const maximizeLabel = isMaximized ? t('customWco.restore', 'Restore') : t('customWco.maximize', 'Maximize')
  const closeLabel = t('customWco.close', 'Close')

  // Hover-tooltip handlers — no-ops when `hoverTooltips` is false, so the buttons
  // show no label on hover (their `aria-label` still names them for a11y).
  const handleWcoEnter = (label: string) => (e: React.MouseEvent<HTMLElement>): void => {
    if (!hoverTooltips) return
    wcoTooltipRef.current = e.currentTarget
    setHoveredWco(label)
  }
  const handleWcoLeave = (): void => { setHoveredWco(null) }

  const buttonRow = (
    <div className="window-controls-container">
      <div
        className="window-button minimize"
        onClick={handleMinimize}
        aria-label={minimizeLabel}
        onMouseEnter={handleWcoEnter(minimizeLabel)}
        onMouseLeave={handleWcoLeave}
        {...(dataTestId && { 'data-testid': `${dataTestId}-minimize` })}
      >
        <span className="codicon codicon-chrome-minimize"></span>
      </div>
      <div
        className="window-button maximize"
        onClick={handleMaximize}
        aria-label={maximizeLabel}
        onMouseEnter={handleWcoEnter(maximizeLabel)}
        onMouseLeave={handleWcoLeave}
        {...(dataTestId && { 'data-testid': `${dataTestId}-maximize` })}
      >
        <span className={`codicon ${isMaximized ? 'codicon-chrome-restore' : 'codicon-chrome-maximize'}`}></span>
      </div>
      <div
        className="window-button close"
        onClick={handleClose}
        aria-label={closeLabel}
        onMouseEnter={handleWcoEnter(closeLabel)}
        onMouseLeave={handleWcoLeave}
        {...(dataTestId && { 'data-testid': `${dataTestId}-close` })}
      >
        <span className="codicon codicon-chrome-close"></span>
      </div>
      {hoverTooltips && (
        <Tooltip
          targetRef={wcoTooltipRef as React.RefObject<HTMLElement>}
          content={hoveredWco}
          show={hoveredWco !== null}
          placement="below"
        />
      )}
    </div>
  )

  return (
    <div className={`custom-wco ${className}`} {...(dataTestId && { 'data-testid': dataTestId })}>
      {typeof document !== 'undefined' ? createPortal(buttonRow, document.body) : buttonRow}
    </div>
  )
}

export default CustomWCO
