import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { InputBox } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioCodeField } from './ScenarioCodeField'

/** Default + hard cap on the per-node execution budget (seconds), mirroring the
 * `codeExecutor` (which clamps `config.timeout` to [1, 60] s). */
const DEFAULT_TIMEOUT_SEC = 5
const MAX_TIMEOUT_SEC = 60

const DEFAULT_CODE = '// `input` = wired value, `vars` = run variables\n// curated stdlib: _, lodash, moment, uuid, nanoid, CryptoJS, Ajv\nreturn input'

/**
 * `code` — runs user TypeScript/JavaScript in the QuickJS sandbox. The wired
 * `value` input is exposed as `input`, run variables as `vars`, and the curated
 * standard library as globals; whatever the script returns flows out of `result`.
 */
export const CodeNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const code = typeof config['code'] === 'string' ? config['code'] : ''
  const timeoutSec = typeof config['timeout'] === 'number' && config['timeout'] > 0 ? config['timeout'] : DEFAULT_TIMEOUT_SEC

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.code.input', 'input'),
      port: { id: 'value', type: 'target' }
    },
    {
      id: 'code',
      content: (
        <ScenarioCodeField
          value={code}
          onChange={(next) => { data.onSetConfig?.(id, { code: next }) }}
          language="typescript"
          caption={t('scenario.code.code', 'code (TypeScript)')}
          modalTitle={t('scenario.code.modalTitle', 'Edit code')}
          placeholder={DEFAULT_CODE}
          dataTestId={`scn-code-${id}`}
        />
      )
    },
    {
      id: 'timeout',
      content: (
        <div className="nodrag scn-code-timeout" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.code.timeout', 'Timeout (s)')}</div>
          <InputBox
            value={String(timeoutSec)}
            onChange={(next) => {
              const n = Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.floor(Number(next) || DEFAULT_TIMEOUT_SEC)))
              data.onSetConfig?.(id, { timeout: n })
            }}
            options={{ type: 'number', min: 1, max: MAX_TIMEOUT_SEC, ariaLabel: t('scenario.code.timeout', 'Timeout (s)') }}
            data-testid={`scn-code-${id}-timeout`}
          />
        </div>
      )
    }
  ]

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.code.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default CodeNodeBox
