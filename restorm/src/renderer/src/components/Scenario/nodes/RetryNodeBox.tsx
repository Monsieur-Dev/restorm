import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, Toggle, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

const BACKOFFS = ['fixed', 'linear', 'exponential'] as const
const UNITS = ['ms', 's', 'min'] as const

/**
 * `retry` — re-runs the body wired off `attempt` as an error-boundary scope,
 * with a backoff policy, up to `maxAttempts`. Success exits via the implicit
 * `done` port; giving up via `exhausted`. The HTTP-status conditions retry any
 * action; they're most useful when an httpRequest sits in the body.
 */
export const RetryNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const maxAttempts = typeof config['maxAttempts'] === 'number' ? config['maxAttempts'] : 3
  const backoff = (BACKOFFS as readonly string[]).includes(config['backoff'] as string) ? (config['backoff'] as string) : 'fixed'
  const delay = typeof config['delay'] === 'number' ? config['delay'] : 0
  const delayUnit = (UNITS as readonly string[]).includes(config['delayUnit'] as string) ? (config['delayUnit'] as string) : 'ms'
  const factor = typeof config['factor'] === 'number' ? config['factor'] : 2
  const retryOnError = config['retryOnError'] !== false
  const retryOnFailure = config['retryOnFailure'] === true
  const retryOnStatus = typeof config['retryOnStatus'] === 'string' ? config['retryOnStatus'] : ''

  const numRow = (key: string, val: number, testid: string, placeholder?: string): ScenarioNodeCell => ({
    id: key,
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t(`scenario.retry.${key}`, key)}</div>
        <InputBox
          value={String(val)}
          onChange={(next) => { const n = Number(next); data.onSetConfig?.(id, { [key]: Number.isFinite(n) ? n : 0 }) }}
          options={{ type: 'number', ...(placeholder ? { placeholder } : {}) }}
          data-testid={testid}
        />
      </div>
    )
  })

  const rows: ScenarioNodeCell[] = [
    numRow('maxAttempts', maxAttempts, 'scn-retry-maxattempts', '3'),
    {
      id: 'backoff',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.retry.backoff', 'backoff')}</div>
          <SelectBox
            id={`scn-retry-backoff-${id}`}
            className=""
            options={BACKOFFS.map((b) => ({ text: b, label: t(`scenario.retry.backoffOpt.${b}`, b) }))}
            selected={Math.max(0, BACKOFFS.indexOf(backoff as typeof BACKOFFS[number]))}
            onDidSelect={(d: ISelectData) => { const next = BACKOFFS[d.index]; if (next) data.onSetConfig?.(id, { backoff: next }) }}
            data-testid="scn-retry-backoff"
          />
        </div>
      )
    },
    {
      id: 'delay',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.retry.delay', 'delay')}</div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <InputBox
              value={String(delay)}
              onChange={(next) => { const n = Number(next); data.onSetConfig?.(id, { delay: Number.isFinite(n) ? n : 0 }) }}
              options={{ type: 'number' }}
              data-testid="scn-retry-delay"
            />
            <SelectBox
              id={`scn-retry-delayunit-${id}`}
              className=""
              options={UNITS.map((u) => ({ text: u, label: u }))}
              selected={Math.max(0, UNITS.indexOf(delayUnit as typeof UNITS[number]))}
              onDidSelect={(d: ISelectData) => { const next = UNITS[d.index]; if (next) data.onSetConfig?.(id, { delayUnit: next }) }}
              data-testid="scn-retry-delayunit"
            />
          </div>
        </div>
      )
    }
  ]

  if (backoff === 'exponential') {
    rows.push(numRow('factor', factor, 'scn-retry-factor', '2'))
  }

  rows.push(
    {
      id: 'retryOnError',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <Toggle
            checked={retryOnError}
            onChange={(checked) => { data.onSetConfig?.(id, { retryOnError: checked }) }}
            data-testid="scn-retry-onerror"
          >
            {t('scenario.retry.retryOnError', 'retry on error')}
          </Toggle>
        </div>
      )
    },
    {
      id: 'retryOnStatus',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.retry.retryOnStatus', 'retry on HTTP status')}</div>
          <InputBox
            value={retryOnStatus}
            onChange={(next) => { data.onSetConfig?.(id, { retryOnStatus: next }) }}
            options={{ type: 'text', placeholder: '429, 503' }}
            data-testid="scn-retry-onstatus"
          />
        </div>
      )
    },
    {
      id: 'retryOnFailure',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <Toggle
            checked={retryOnFailure}
            onChange={(checked) => { data.onSetConfig?.(id, { retryOnFailure: checked }) }}
            data-testid="scn-retry-onfailure"
          >
            {t('scenario.retry.retryOnFailure', 'retry on any non-2xx')}
          </Toggle>
        </div>
      )
    }
  )

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'attempt', label: t('scenario.retry.attempt', 'attempt'), port: { id: 'attempt', role: 'then', type: 'source' } },
    { id: 'exhausted', label: t('scenario.retry.exhausted', 'exhausted'), port: { id: 'exhausted', role: 'else', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default RetryNodeBox
