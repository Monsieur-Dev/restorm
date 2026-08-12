import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import './editableLabel.css'

export type EditableLabelAs =
  | 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div'

export interface EditableLabelProps {
  value: string
  onChange: (next: string) => void

  /** Element rendered in read mode. Default: 'span'. */
  as?: EditableLabelAs

  /** When false, clicking does nothing and no pencil appears. Default: true. */
  editable?: boolean

  /** Optional controlled edit-mode — when provided, parent owns the edit state. */
  isEditing?: boolean
  onEditingChange?: (editing: boolean) => void

  /** Placeholder shown inside the input when value is empty. */
  placeholder?: string

  /** Maximum length for the input. */
  maxLength?: number

  /** Force a specific input type. Only 'text' for now; added for future
   * single-line variants (e.g. 'email', 'url') — accepted here as a
   * hook without widening today's behaviour. */
  inputType?: 'text'

  /** Validator — return string error to block commit; falsy to accept. */
  validate?: (next: string) => string | null | undefined

  /** Class forwarded to the root element (read + edit modes). */
  className?: string

  /** Optional extra class applied to the input in edit mode. */
  inputClassName?: string

  'data-testid'?: string

  /** A tooltip message shown on hover of the pencil (i18n responsibility of caller). */
  editTooltip?: string
}

interface EditingViewProps {
  initialValue: string
  currentValue: string
  placeholder?: string | undefined
  maxLength?: number | undefined
  inputType: 'text'
  validate?: ((next: string) => string | null | undefined) | undefined
  ariaLabel: string
  testId?: string | undefined
  inputClassName?: string | undefined
  onCommit: (trimmed: string) => void
  onCancel: () => void
}

/**
 * Edit-mode subtree. Owns the draft / error state and is remounted on
 * every transition into edit mode (via `key` in the parent) so those
 * states start fresh — keeping us out of the "sync prop into state via
 * useEffect" anti-pattern.
 */
const EditingView: React.FC<EditingViewProps> = ({
  initialValue,
  currentValue,
  placeholder,
  maxLength,
  inputType,
  validate,
  ariaLabel,
  testId,
  inputClassName,
  onCommit,
  onCancel
}) => {
  const [draft, setDraft] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Suppress the next blur-commit when Enter / Escape triggered the
  // commit/cancel explicitly — otherwise the blur handler runs a
  // second time and either re-commits a stale draft or re-enters
  // the already-reset cancel path.
  const ignoreNextBlur = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const commit = useCallback((): void => {
    const trimmed = draft.trim()
    if (trimmed === currentValue.trim()) {
      // No change → let the parent close edit mode without firing onChange.
      onCancel()
      return
    }
    if (validate) {
      const err = validate(trimmed)
      if (err) {
        setError(err)
        inputRef.current?.focus()
        return
      }
    }
    onCommit(trimmed)
  }, [currentValue, draft, onCancel, onCommit, validate])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault()
        ignoreNextBlur.current = true
        commit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        ignoreNextBlur.current = true
        onCancel()
      }
      // Tab: let the browser move focus naturally; the ensuing blur
      // commits via `handleBlur`.
    },
    [commit, onCancel]
  )

  const handleBlur = useCallback((): void => {
    if (ignoreNextBlur.current) {
      ignoreNextBlur.current = false
      return
    }
    commit()
  }, [commit])

  const inputClasses = useMemo(() => {
    const parts = ['ecui-editable-label-input']
    if (inputClassName) parts.push(inputClassName)
    return parts.join(' ')
  }, [inputClassName])

  return (
    <>
      <input
        ref={inputRef}
        className={inputClasses}
        type={inputType}
        value={draft}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(maxLength !== undefined ? { maxLength } : {})}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        {...(error ? { 'aria-describedby': `${testId ?? 'ecui-editable-label'}-error` } : {})}
        onChange={(event): void => { setDraft(event.target.value) }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        {...(testId ? { 'data-testid': `${testId}-input` } : {})}
      />
      {error ? (
        <span
          className="ecui-editable-label-error"
          id={`${testId ?? 'ecui-editable-label'}-error`}
          role="alert"
          aria-live="polite"
          {...(testId ? { 'data-testid': `${testId}-error` } : {})}
        >
          {error}
        </span>
      ) : null}
    </>
  )
}

/**
 * Inline-editable label: renders as any text element (span / h1 / …),
 * shows a pencil icon on hover / keyboard focus when editable, clicks
 * into an auto-focused input, and commits on Enter / blur / Tab. See
 * `docs/EditableLabel/README.md` for the full behaviour matrix.
 *
 * Interactive semantics live on a nested `<button>`, not on the
 * polymorphic `as` element — that way a heading (e.g. `as="h2"`) keeps
 * its heading level for screen readers while still exposing a click /
 * keyboard affordance.
 */
export const EditableLabel: React.FC<EditableLabelProps> = ({
  value,
  onChange,
  as = 'span',
  editable = true,
  isEditing: controlledIsEditing,
  onEditingChange,
  placeholder,
  maxLength,
  inputType = 'text',
  validate,
  className,
  inputClassName,
  'data-testid': dataTestId,
  editTooltip
}) => {
  const [uncontrolledIsEditing, setUncontrolledIsEditing] = useState(false)
  const isControlled = controlledIsEditing !== undefined
  const isEditing = isControlled ? controlledIsEditing : uncontrolledIsEditing

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  // A counter that bumps every time we transition into edit mode.
  // Used as the `key` on `<EditingView>` so it remounts with fresh
  // draft/error state across successive edit sessions without us
  // mirroring `value` into state via an effect.
  const [editSession, setEditSession] = useState(0)
  // Return focus to the trigger after exiting edit mode, but only
  // when the exit was driven by this component. A parent-driven
  // `isEditing=false` shouldn't steal focus from wherever the parent
  // placed it.
  const shouldRestoreFocus = useRef(false)

  const setEditing = useCallback((next: boolean): void => {
    if (!isControlled) setUncontrolledIsEditing(next)
    onEditingChange?.(next)
  }, [isControlled, onEditingChange])

  useEffect(() => {
    if (!isEditing && shouldRestoreFocus.current) {
      shouldRestoreFocus.current = false
      triggerRef.current?.focus()
    }
  }, [isEditing])

  const enterEditMode = useCallback((): void => {
    if (!editable) return
    setEditSession((n) => n + 1)
    setEditing(true)
  }, [editable, setEditing])

  const handleCommit = useCallback((next: string): void => {
    onChange(next)
    shouldRestoreFocus.current = true
    setEditing(false)
  }, [onChange, setEditing])

  const handleCancel = useCallback((): void => {
    shouldRestoreFocus.current = true
    setEditing(false)
  }, [setEditing])

  const rootClassName = useMemo(() => {
    const parts = ['ecui-editable-label']
    if (editable) parts.push('ecui-editable-label--editable')
    if (isEditing) parts.push('ecui-editable-label--editing')
    if (className) parts.push(className)
    return parts.join(' ')
  }, [className, editable, isEditing])

  const Tag = as as React.ElementType
  const ariaLabel = editTooltip ?? `Edit ${value}`

  if (isEditing) {
    return (
      <Tag
        className={rootClassName}
        {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
      >
        <EditingView
          key={editSession}
          initialValue={value}
          currentValue={value}
          placeholder={placeholder}
          maxLength={maxLength}
          inputType={inputType}
          validate={validate}
          ariaLabel={ariaLabel}
          testId={dataTestId}
          inputClassName={inputClassName}
          onCommit={handleCommit}
          onCancel={handleCancel}
        />
      </Tag>
    )
  }

  // Read mode. Interactive semantics go on a nested `<button>` so the
  // polymorphic `as` tag keeps its native semantics (heading levels,
  // paragraph flow, etc.) — WAI-ARIA's `role="button"` would otherwise
  // clobber the `h2`/`h6` announcement for assistive tech. Native
  // buttons also get Enter/Space handling for free, no extra keydown
  // handler needed.
  return (
    <Tag
      className={rootClassName}
      {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
    >
      {editable ? (
        <button
          type="button"
          ref={triggerRef}
          className="ecui-editable-label-trigger"
          aria-label={ariaLabel}
          onClick={enterEditMode}
        >
          <span className="ecui-editable-label-text">{value}</span>
          <i
            className="codicon codicon-edit ecui-editable-label-pencil"
            aria-hidden="true"
            {...(editTooltip ? { title: editTooltip } : {})}
          />
        </button>
      ) : (
        <span className="ecui-editable-label-text">{value}</span>
      )}
    </Tag>
  )
}
