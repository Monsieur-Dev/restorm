/**
 * Modal-style prompt that collects every `input` node's value before a
 * scenario run starts. Scoped to the scenario tab (not the whole
 * window): the backdrop covers only the editor's wrapper, so the user
 * can still interact with other workbench tabs / the sidebar.
 *
 * Two stages:
 *  - **Up-front collection** (the common case): at run start, gather
 *    every input node with no required predecessor + render one form
 *    with default-prefilled, TYPE-AWARE editors. A `customList` input
 *    renders the list's combobox, a `numeric` a number field, etc. —
 *    the same `TypedValueField` the node box itself uses, so the
 *    prompt honours the variable's declared type. On Submit, the
 *    engine launches with the resolved concrete values.
 *  - **Mid-run prompting** (less common): if an input node has
 *    predecessors and activates during the run, the engine pauses
 *    that node, the editor pops a single-field prompt, and resumes
 *    once the value is captured.
 *
 * No ECUI Modal involved — the inline overlay lets us scope the
 * backdrop to the tab without modifying ECUI's portal target.
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import type { ScenarioNode } from '../../../../shared/types/scenario'
import type { ValueType } from '../../../../shared/types/collections'
import { StringValue } from '../../../../shared/types/collections'
import { concreteValue } from '../../../../shared/utils/scenarioStaticPreview'
import { serializeValueForPersistence } from '../../../../shared/utils/valuePersistence'
import { normalizeValueType } from '../../utils/normalizeValueType'
import { useAllEnvValueTypeGroups } from '../../hooks/useAllEnvValueTypeGroups'
import { TypedValueField } from '../TypedValueField'
import './scenarioInputPrompt.css'

interface InputField {
  nodeId: string
  name: string
  /** The node's declared default, as a `ValueType` instance — drives
   * the typed editor (combobox for `customList`, number field for
   * `numeric`, …) so the prompt matches the box's own type picker. */
  valueType: ValueType
}

export interface ScenarioInputPromptProps {
  /** All input nodes the scenario carries. Filter happens here so the
   * caller doesn't need to know the predecessor topology. */
  inputNodes: ScenarioNode[]
  /** Set of node ids that have at least one required predecessor —
   * the prompt skips those (they'll prompt mid-run when they
   * activate). */
  predecessorBlocked: ReadonlySet<string>
  open: boolean
  onSubmit: (values: Record<string, unknown>) => void
  onCancel: () => void
}

export const ScenarioInputPrompt: React.FC<ScenarioInputPromptProps> = ({ inputNodes, predecessorBlocked, open, onSubmit, onCancel }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const fields: InputField[] = inputNodes
    .filter((n) => n.kind === 'input' && !predecessorBlocked.has(n.id))
    .map((n) => {
      const cfg = n.config as { name?: string; valueType?: unknown }
      const name = typeof cfg.name === 'string' && cfg.name !== '' ? cfg.name : n.id
      return {
        nodeId: n.id,
        name,
        valueType: cfg.valueType !== undefined ? normalizeValueType(cfg.valueType) : new StringValue('')
      }
    })
  const [values, setValues] = useState<Record<string, ValueType>>({})

  // RESET to the nodes' current defaults on each open transition, via a
  // render-phase compare-and-set (no effect — matches
  // `ScenarioMidRunInputPrompt`). Edits made while the prompt stays open
  // aren't clobbered (the reset only fires on the closed→open edge), but
  // reopening after the user changed an input's default picks up the new
  // value instead of stickily keeping the previous run's pick.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    const fresh: Record<string, ValueType> = {}
    for (const f of fields) fresh[f.name] = f.valueType
    setValues(fresh)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  if (!open) return null

  // No fields to collect → render nothing. We must NOT call `onSubmit`
  // here: doing it during render let React invoke it multiple times,
  // firing several `engine.start` from one Play click. The caller
  // (`onEngineRun`) now starts directly when there are no inputs, so
  // this branch is just a safe no-op.
  if (fields.length === 0) return null

  const submit = (e: React.SyntheticEvent): void => {
    e.preventDefault()
    const payload: Record<string, unknown> = {}
    for (const f of fields) {
      const vt = values[f.name] ?? f.valueType
      // Collapse the typed value to the concrete primitive the engine
      // seeds with (a `customList` → its picked label, a `numeric` →
      // the number, …). `serializeValueForPersistence` mirrors the
      // node config bag, `concreteValue` resolves it the same way the
      // scheduler does on a seeded root.
      payload[f.name] = concreteValue(serializeValueForPersistence(vt))
    }
    onSubmit(payload)
  }

  return (
    <div className="scn-input-prompt-backdrop" data-testid="scn-input-prompt-backdrop">
      <form className="scn-input-prompt" onSubmit={submit} data-testid="scn-input-prompt">
        <header className="scn-input-prompt-header">
          {t('scenario.runPrompt.title', 'Run parameters')}
        </header>
        <div className="scn-input-prompt-body">
          {fields.map((f) => (
            <div key={f.nodeId} className="scn-input-prompt-field">
              <span className="scn-input-prompt-label">{f.name}</span>
              <TypedValueField
                value={values[f.name] ?? f.valueType}
                onChange={(next) => { setValues((prev) => ({ ...prev, [f.name]: next })) }}
                valueTypeGroups={valueTypeGroups}
                dataTestId={`scn-input-prompt-${f.name}`}
              />
            </div>
          ))}
        </div>
        <footer className="scn-input-prompt-footer">
          <Button secondary onClick={onCancel} options={{ ariaLabel: t('common.cancel', 'Cancel') }} data-testid="scn-input-prompt-cancel">
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button emphasis={1} icon="play" onClick={(e) => { submit(e) }} data-testid="scn-input-prompt-submit">
            {t('scenario.runPrompt.run', 'Run')}
          </Button>
        </footer>
      </form>
    </div>
  )
}

function stringifyDefault(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}

// ----------------------------------------------------------------
// Mid-run single-field prompt
// ----------------------------------------------------------------

export interface ScenarioMidRunInputPromptProps {
  open: boolean
  name: string
  defaultValue: unknown
  hint: 'string' | 'number' | 'boolean' | 'object'
  onSubmit: (value: unknown) => void
}

/** Surfaces a single `input` node's request mid-run. No Cancel —
 * cancelling here would orphan the run; the user can hit Stop in
 * the inspector toolbar if they want to abort. The default value
 * is the upstream node's emission. */
export const ScenarioMidRunInputPrompt: React.FC<ScenarioMidRunInputPromptProps> = ({ open, name, defaultValue, hint, onSubmit }) => {
  const { t } = useTranslation()
  // Compare-and-set in render: when the prompt mounts (or opens with a
  // fresh default), reset the input to the upstream default — without
  // a state-in-effect rule violation.
  const [lastSeed, setLastSeed] = useState<unknown>(open ? defaultValue : null)
  const [raw, setRaw] = useState(stringifyDefault(defaultValue))
  if (open && lastSeed !== defaultValue) {
    setLastSeed(defaultValue)
    setRaw(stringifyDefault(defaultValue))
  }
  if (!open) return null
  const submit = (e: React.SyntheticEvent): void => {
    e.preventDefault()
    onSubmit(coerce(raw, hint))
  }
  return (
    <div className="scn-input-prompt-backdrop" data-testid="scn-mid-run-input-prompt-backdrop">
      <form className="scn-input-prompt" onSubmit={submit} data-testid="scn-mid-run-input-prompt">
        <header className="scn-input-prompt-header">
          {t('scenario.runPrompt.midRunTitle', 'Input requested')}
        </header>
        <div className="scn-input-prompt-body">
          <label className="scn-input-prompt-field">
            <span className="scn-input-prompt-label">{name}</span>
            <input
              type="text"
              className="scn-input-prompt-input"
              autoFocus
              value={raw}
              onChange={(e) => { setRaw(e.target.value) }}
              data-testid={`scn-mid-run-input-${name}`}
            />
          </label>
        </div>
        <footer className="scn-input-prompt-footer">
          <Button emphasis={1} icon="check" onClick={(e) => { submit(e) }} data-testid="scn-mid-run-input-submit">
            {t('common.ok', 'OK')}
          </Button>
        </footer>
      </form>
    </div>
  )
}

function coerce(raw: string, hint: ScenarioMidRunInputPromptProps['hint']): unknown {
  switch (hint) {
    case 'number': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : raw
    }
    case 'boolean': return raw === 'true' || raw === '1' || raw.toLowerCase() === 'yes'
    case 'object': {
      try { return JSON.parse(raw) } catch { return raw }
    }
    case 'string':
    default: return raw
  }
}
