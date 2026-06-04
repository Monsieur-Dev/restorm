/**
 * One prompt for EVERY user input a run needs — up-front and mid-run alike.
 *
 * Driven purely by the engine's `pendingInputs`: at run start every
 * predecessor-less input's params are pending together (they fire at once), so
 * the modal collects them in a single form; a predecessor-wired input that
 * activates mid-run pends only when the flow reaches it, so the same modal then
 * surfaces its fields. No predecessor topology to track here — what's pending IS
 * what to ask. Each field is the type-aware `TypedValueField` (a datetime gets a
 * picker, a custom-list a combobox, …), keyed by the param name.
 *
 * Scoped to the scenario tab (not the whole window): the backdrop covers only
 * the editor's wrapper, so the user can still use other workbench tabs / the
 * sidebar. No ECUI Modal involved — the inline overlay lets us scope the
 * backdrop without modifying ECUI's portal target.
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import type { ValueType } from '../../../../shared/types/collections'
import { StringValue } from '../../../../shared/types/collections'
import { concreteValue } from '../../../../shared/utils/scenarioStaticPreview'
import { serializeValueForPersistence } from '../../../../shared/utils/valuePersistence'
import { normalizeValueType } from '../../utils/normalizeValueType'
import { useAllEnvValueTypeGroups } from '../../hooks/useAllEnvValueTypeGroups'
import type { PendingUserInput } from '../../hooks/useScenarioEngine'
import { TypedValueField } from '../TypedValueField'
import './scenarioInputPrompt.css'

export interface ScenarioInputPromptProps {
  /** Every input request the run is currently waiting on (up-front + mid-run). */
  pendingInputs: readonly PendingUserInput[]
  /** Feed one request's confirmed value into the live run. */
  onResolve: (requestId: string, value: unknown) => void
  /** Cancel every shown request — each input node routes to its `error` output
   * (or fails the run if `error` is unwired). */
  onCancel: (requestIds: string[]) => void
}

function stringifyDefault(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}

/** The editor's initial typed value for a pending input: the param's declared
 * type, with its value overlaid by the runtime default (the configured default
 * up-front, the upstream emission mid-run). */
function seedTypedValue(valueType: unknown, defaultValue: unknown): ValueType {
  if (valueType !== null && typeof valueType === 'object') {
    const pojo = valueType as Record<string, unknown>
    // `environment` and `variable` keep a REFERENCE in `value` (an environment
    // id / a variable name). The engine's concrete default for them is a
    // resolved or templated form (`{{$env-id}}`, `{{name}}`) — overlaying it
    // would overwrite the reference, leaving the picker unable to match it (it
    // shows "—"). Seed those straight from the declared type so the configured
    // default (e.g. the selected environment) shows through. Other typed values
    // hold their concrete in `value`, so the default overlays cleanly — and a
    // mid-run input still prefills with the upstream value.
    const holdsReference = pojo['type'] === 'environment' || pojo['type'] === 'variable'
    if (!holdsReference && defaultValue !== undefined && 'value' in pojo) {
      return normalizeValueType({ ...pojo, value: defaultValue })
    }
    return normalizeValueType(valueType)
  }
  return new StringValue(stringifyDefault(defaultValue))
}

export const ScenarioInputPrompt: React.FC<ScenarioInputPromptProps> = ({ pendingInputs, onResolve, onCancel }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const open = pendingInputs.length > 0

  // Typed value per pending request, keyed by requestId. Re-seed whenever the
  // SET of pending requests changes (a render-phase compare-and-set, no effect):
  // newly-appeared requests get their default; edits to still-pending ones are
  // preserved; resolved ones drop out.
  const [values, setValues] = useState<Record<string, ValueType>>({})
  const pendingKey = pendingInputs.map((p) => p.requestId).join('|')
  const [seededKey, setSeededKey] = useState('')
  if (pendingKey !== seededKey) {
    setSeededKey(pendingKey)
    setValues((prev) => {
      const next: Record<string, ValueType> = {}
      for (const p of pendingInputs) next[p.requestId] = prev[p.requestId] ?? seedTypedValue(p.valueType, p.defaultValue)
      return next
    })
  }

  if (!open) return null

  const submit = (e: React.SyntheticEvent): void => {
    e.preventDefault()
    for (const p of pendingInputs) {
      const vt = values[p.requestId] ?? seedTypedValue(p.valueType, p.defaultValue)
      // Collapse the typed value to the concrete primitive the engine seeds
      // with — the same path the scheduler resolves a seeded root through.
      onResolve(p.requestId, concreteValue(serializeValueForPersistence(vt)))
    }
  }

  return (
    <div className="scn-input-prompt-backdrop" data-testid="scn-input-prompt-backdrop">
      <form className="scn-input-prompt" onSubmit={submit} data-testid="scn-input-prompt">
        <header className="scn-input-prompt-header">
          {t('scenario.runPrompt.title', 'Run parameters')}
        </header>
        <div className="scn-input-prompt-body">
          {pendingInputs.map((p) => (
            <div key={p.requestId} className="scn-input-prompt-field">
              <span className="scn-input-prompt-label">{p.name}</span>
              <TypedValueField
                value={values[p.requestId] ?? seedTypedValue(p.valueType, p.defaultValue)}
                onChange={(next) => { setValues((prev) => ({ ...prev, [p.requestId]: next })) }}
                valueTypeGroups={valueTypeGroups}
                lockType
                dataTestId={`scn-input-prompt-${p.name}`}
              />
            </div>
          ))}
        </div>
        <footer className="scn-input-prompt-footer">
          <Button secondary onClick={() => { onCancel(pendingInputs.map((p) => p.requestId)) }} options={{ ariaLabel: t('common.cancel', 'Cancel') }} data-testid="scn-input-prompt-cancel">
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
