import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import './button.css'
import { IButtonOptions, IButtonStyles, ButtonProps, defaultButtonStyles } from './types'
import { getContrastColor } from '../../utils/colorContrast'
import { getCodiconOpticalOffset } from '../../utils/codiconOpticalCentre'
import { IconView } from '../IconView'

const Button: React.FC<ButtonProps> = ({
  options = {},
  icon,
  disabled = false,
  secondary = false,
  appearance = 'default',
  size,
  small = false,
  medium = false,
  line = false,
  link = false,
  externalLink = false,
  emphasis = 0,
  fullWidth = false,
  backgroundColor,
  align,
  cornerBadge,
  onClick,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  className = '',
  style,
  id,
  role = 'button',
  'aria-checked': ariaChecked,
  'aria-expanded': ariaExpanded,
  'aria-haspopup': ariaHasPopup,
  tabIndex,
  'data-testid': dataTestId,
  children
}) => {
  // The round appearance paints a coloured disc whose glyph must stay legible
  // on ANY background — including a theme token this component cannot see from
  // JavaScript. Both the contrast colour and the glyph's optical offset are
  // therefore measured from what the element actually renders, once mounted.
  const surfaceRef = useRef<HTMLAnchorElement | null>(null)
  const [discGlyph, setDiscGlyph] = useState<{ color: string, dx: number, dy: number } | null>(null)

  const isRound = appearance === 'round'
  const roundGlyph = typeof icon === 'string' ? icon : null
  useLayoutEffect(() => {
    if (!isRound) return
    let cancelled = false
    const measure = (): void => {
      if (cancelled) return
      const el = surfaceRef.current
      if (!el) return
      // The disc's colour may come from `backgroundColor` OR from a theme
      // token this component cannot read in JS — so take what is painted.
      const painted = window.getComputedStyle(el).backgroundColor
      const glyphEl = el.querySelector('.codicon')
      const offset = roundGlyph !== null && glyphEl
        ? getCodiconOpticalOffset(roundGlyph, Number.parseFloat(window.getComputedStyle(glyphEl).fontSize))
        : null
      setDiscGlyph({
        color: getContrastColor(painted),
        dx: offset?.dx ?? 0,
        dy: offset?.dy ?? 0
      })
    }
    measure()
    // The glyph font arrives after first paint; re-measure once it has.
    const { fonts } = document as Omit<Document, 'fonts'> & { fonts?: FontFaceSet }
    if (fonts) void fonts.ready.then(measure)
    return () => { cancelled = true }
  }, [isRound, roundGlyph, backgroundColor, size, small])

  // Resolve size — `size` prop wins; `small` / `medium` are shorthand aliases
  // for `size: 'sm'` / `size: 'md'` kept for ergonomic call sites.
  const effectiveSize = size ?? (small ? 'sm' : medium ? 'md' : 'default')
  const buttonRef = useRef<HTMLAnchorElement>(null)

  // Merge options with default styles
  const mergedOptions: IButtonOptions & IButtonStyles = {
    ...defaultButtonStyles,
    ...options
  }

  // Handle click events
  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }, [disabled, onClick])

  // Handle keyboard events
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (disabled) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick?.(event as unknown as React.MouseEvent<HTMLAnchorElement>)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      buttonRef.current?.blur()
    }
  }, [disabled, onClick])

  // Right-click — preventDefault (suppress the native menu) then delegate.
  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (disabled || !onContextMenu) return
    event.preventDefault()
    onContextMenu(event)
  }, [disabled, onContextMenu])

  // No need for hover/focus state management - CSS handles it

  // Render icon if provided. String form is the codicon shorthand
  // (kept for backwards compat); the object form delegates to
  // `IconView` so any library supported by ECUI's icon system
  // (emoji, iconoir, phosphor, material, simpleicons, feather,
  // fontawesome) renders without the call site needing to wrap
  // its own `<IconView>`.
  const renderIcon = (): React.ReactNode => {
    if (!icon) return null
    if (typeof icon === 'string') {
      return <span className={`codicon codicon-${icon}`} />
    }
    // A ready-made element (e.g. a `<Badge>`) renders verbatim in the leading slot.
    if (React.isValidElement(icon)) {
      return icon
    }
    return <IconView icon={icon} size={14} />
  }

  // Render children with icon support
  const renderChildren = (): React.ReactNode => {
    if (!children) return null

    // If children is a string, parse for $(iconName) pattern
    if (typeof children === 'string') {
      const iconRegex = /\$\(([^)]+)\)/g
      const parts = children.split(iconRegex)
      
      return parts.map((part, index) => {
        if (index % 2 === 1) {
          // This is an icon name
          return <span key={index} className={`codicon codicon-${part}`} />
        } else {
          // This is text
          return part
        }
      })
    }

    // If children is not a string, render as-is
    return children
  }

  // The `small-button` / `large-button` / `xl-button` class names are
  // kept (rather than `size-sm` / `size-lg` / `size-xl`) because
  // `small-button` is the historical CSS hook for the toolbar/icon
  // 20×20 surface — renaming it would force a CSS rewrite for the
  // many call sites that style around it.
  const buttonClasses = [
    'button',
    'text-button',
    effectiveSize === 'sm' ? 'small-button' : '',
    effectiveSize === 'md' ? 'medium-button' : '',
    effectiveSize === 'lg' ? 'large-button' : '',
    effectiveSize === 'xl' ? 'xl-button' : '',
    appearance !== 'default' ? `appearance-${appearance}` : '',
    line ? 'line-button' : '',
    link || externalLink ? 'link-button' : '',
    externalLink ? 'external-link-button' : '',
    secondary ? 'secondary' : '',
    disabled ? 'disabled' : '',
    fullWidth ? 'full-width' : '',
    emphasis > 0 ? `emphasis-${String(emphasis)}` : '',
    'default-colors',
    className
  ].filter(Boolean).join(' ')

  // Merge any caller-provided style overrides. Explicit
  // `backgroundColor` wins over `style.background*` so the prop is
  // the authoritative way to tint the button surface. `align`
  // mirrors CSS `text-align` + flex `justify-content` so the label
  // hugs the chosen edge regardless of layout mode.
  const alignToJustify: Record<NonNullable<ButtonProps['align']>, React.CSSProperties['justifyContent']> = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end'
  }
  const inlineStyles: React.CSSProperties = {
    ...style,
    ...(backgroundColor !== undefined ? { background: backgroundColor } : {}),
    ...(align !== undefined ? { textAlign: align, justifyContent: alignToJustify[align] } : {}),
    ...(isRound && discGlyph
      ? {
          ['--ecui-round-glyph-color' as string]: discGlyph.color,
          ['--ecui-round-glyph-dx' as string]: `${discGlyph.dx}px`,
          ['--ecui-round-glyph-dy' as string]: `${discGlyph.dy}px`
        }
      : {})
  }

  const containerClassName = fullWidth ? 'button-container full-width' : 'button-container'

  return (
    <div className={containerClassName}>
      <a
        ref={(node) => { buttonRef.current = node; surfaceRef.current = node }}
        id={id}
        data-testid={dataTestId}
        className={buttonClasses}
        style={inlineStyles}
        onClick={handleClick}
        {...(onContextMenu ? { onContextMenu: handleContextMenu } : {})}
        onKeyDown={handleKeyDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-label={mergedOptions.ariaLabel}
        role={role}
        {...(ariaChecked !== undefined ? { 'aria-checked': ariaChecked } : {})}
        {...(ariaExpanded !== undefined ? { 'aria-expanded': ariaExpanded } : {})}
        {...(ariaHasPopup !== undefined ? { 'aria-haspopup': ariaHasPopup } : {})}
        tabIndex={tabIndex ?? (disabled ? -1 : 0)}
        aria-disabled={disabled}
      >
        {renderIcon()}
        {link || externalLink ? <span className="button-link-label">{renderChildren()}</span> : renderChildren()}
        {externalLink && <span className="codicon codicon-link-external button-link-trailing-icon" aria-hidden="true" />}
      </a>
      {isRound && cornerBadge !== undefined && (
        <span className="ecui-round-corner-badge" aria-hidden="true">{cornerBadge}</span>
      )}
    </div>
  )
}

export { Button }
