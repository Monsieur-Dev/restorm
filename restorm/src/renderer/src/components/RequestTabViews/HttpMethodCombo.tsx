import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, InputBox, ScrollableElement, useOverlayPresence } from 'electron-core-ui/renderer'
import { canonicalizeHttpMethod, KNOWN_HTTP_METHODS } from '../../../../shared/utils/httpMethod'
import { mapToBadgeType } from '../../utils/badgeUtils'
import { Badge } from '../common/Badge'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './httpMethodCombo.css'

interface HttpMethodComboProps {
  /** Current method token (any string — a known verb or a custom one). */
  value: string
  /** Fired on commit (blur, Enter, or picking a verb) with the canonicalized method. */
  onChange: (method: string) => void
  disabled?: boolean
  ariaLabel: string
  /** Hover label for the dropdown affordance. */
  pickerLabel: string
  'data-testid'?: string
}

/**
 * Editable method combo for the HTTP request bar: the user can type an arbitrary
 * verb (e.g. a server-defined `Machin`) OR pick a well-known one from the
 * dropdown. Known verbs are canonicalized to upper-case on commit; a custom verb
 * is kept verbatim (method tokens are case-sensitive, RFC 9110 §5.1.1). Built
 * from ECUI primitives — an `InputBox` for the free-text field and a portaled
 * badge list for the picker — never a native `<select>`/`<input>`.
 */
export const HttpMethodCombo: React.FC<HttpMethodComboProps> = ({
  value,
  onChange,
  disabled = false,
  ariaLabel,
  pickerLabel,
  'data-testid': dataTestId
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const portalContainerRef = useRef<Element | null>(null)
  const [listPos, setListPos] = useState({ top: 0, left: 0, width: 0 })

  // Collapse a native compositor view (Mini browser) out from under the popup,
  // as SelectBox / Tooltip / Modal do — a fixed HTML layer can't out-stack it.
  useOverlayPresence(popupRef, isOpen)

  const commit = useCallback((raw: string): void => {
    const canonical = canonicalizeHttpMethod(raw)
    if (canonical !== value) onChange(canonical)
  }, [onChange, value])

  const pick = useCallback((verb: string): void => {
    setIsOpen(false)
    if (verb !== value) onChange(verb)
  }, [onChange, value])

  useLayoutEffect(() => {
    if (isOpen && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect()
      setListPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 140) })
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (wrapperRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => { document.removeEventListener('mousedown', onClickOutside); }
  }, [isOpen])

  const onInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (e.key === 'Enter') {
      commit(e.currentTarget.value)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowDown' && !isOpen) {
      e.preventDefault()
      setIsOpen(true)
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault()
      setIsOpen(false)
    }
  }, [commit, isOpen])

  return (
    <div
      ref={wrapperRef}
      className="http-method-combo"
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
    >
      <InputBox
        value={value}
        options={{ ariaLabel }}
        disabled={disabled}
        className="http-method-combo-input"
        onBlur={(e) => { commit(e.currentTarget.value); }}
        onKeyDown={onInputKeyDown}
        {...(dataTestId ? { 'data-testid': dataTestId } : {})}
      />
      <HeaderHoverTooltip label={pickerLabel} className="http-method-combo-picker-tooltip">
        <Button
          icon="chevron-down"
          small
          disabled={disabled}
          onClick={() => { setIsOpen((o) => !o); }}
          options={{ ariaLabel: pickerLabel }}
          className="http-method-combo-picker"
          {...(dataTestId ? { 'data-testid': `${dataTestId}-picker` } : {})}
        />
      </HeaderHoverTooltip>
      {isOpen && createPortal(
        <div ref={popupRef} className="http-method-combo-popup" style={{ top: listPos.top, left: listPos.left, width: listPos.width }}>
          <ScrollableElement
            options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, handleMouseWheel: true, fitContent: true }}
            style={{ width: '100%', minHeight: 0, overflow: 'hidden' }}
          >
            <div role="listbox" aria-label={ariaLabel}>
              {KNOWN_HTTP_METHODS.map((verb) => (
                <div
                  key={verb}
                  role="option"
                  aria-selected={verb === value}
                  className={`http-method-combo-option${verb === value ? ' is-selected' : ''}`}
                  onClick={() => { pick(verb); }}
                  data-testid={dataTestId ? `${dataTestId}-option-${verb}` : undefined}
                >
                  <Badge type={mapToBadgeType(verb)} />
                </div>
              ))}
            </div>
          </ScrollableElement>
        </div>,
        (portalContainerRef.current ??= wrapperRef.current?.closest('.workbench') ?? document.body)
      )}
    </div>
  )
}
