import React, { useEffect, useRef, useState } from 'react'

interface ScenarioNameInputProps {
  value: string
  placeholder: string
  onCommit: (next: string) => void
  'data-testid'?: string
}

const DEBOUNCE_MS = 300

/**
 * Single-line name field for a scenario node. Types into local state for an
 * instant, focus-stable response and commits to the node config on a debounce:
 * writing every keystroke straight to the config re-renders + persists the
 * whole scenario, which lags, drops characters and steals focus mid-word. The
 * pending write is flushed immediately on blur so a name is never lost.
 *
 * The debounce is inlined rather than pulled from the shared hooks barrel so
 * this leaf component stays unit-testable without loading the renderer barrel.
 */
export const ScenarioNameInput: React.FC<ScenarioNameInputProps> = ({
  value,
  placeholder,
  onCommit,
  'data-testid': dataTestId
}) => {
  const [draft, setDraft] = useState(value)
  // Last value we synced from the prop — both an externally-set value and our
  // own committed value (which round-trips back through `value`). Drives the
  // external-change adoption below and the blur-flush no-op guard.
  const [syncedValue, setSyncedValue] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always fire the latest closure — onCommit captures live node data.
  const onCommitRef = useRef(onCommit)
  useEffect(() => { onCommitRef.current = onCommit }, [onCommit])

  // Adopt an external value change (reload / undo) without clobbering live
  // typing. Done during render per React's prop-derived-state guidance rather
  // than in an effect — an effect would double-render and trip
  // set-state-in-effect.
  if (value !== syncedValue) {
    setSyncedValue(value)
    setDraft(value)
  }

  // Drop a pending write if the field unmounts before it lands.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleChange = (next: string): void => {
    setDraft(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onCommitRef.current(next)
    }, DEBOUNCE_MS)
  }

  const flush = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (draft !== syncedValue) onCommitRef.current(draft)
  }

  return (
    <input
      className="scn-name-input nodrag"
      value={draft}
      placeholder={placeholder}
      onMouseDown={(e) => { e.stopPropagation() }}
      onChange={(e) => { handleChange(e.target.value) }}
      onBlur={flush}
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
    />
  )
}
