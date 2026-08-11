import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { CRYPTO_OPS, isCryptoOp, cryptoOpNeedsKey, cryptoOpNeedsInput, type CryptoOp } from '../../../../../shared/scenarioCrypto'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'

/**
 * `crypto` — encodes / hashes / signs its `value` string, or generates a UUID.
 * The operation picker drives the fields: `hmacSha256` shows a secret `key`;
 * `uuid` ignores the input so the `value` row is hidden. A missing HMAC key or a
 * non-UTF-8 `base64Decode` surfaces on the implicit `error` port. Op + key +
 * value persist in the node config.
 */
export const CryptoNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: CryptoOp = isCryptoOp(config['op']) ? config['op'] : 'sha256'
  const key = typeof config['key'] === 'string' ? config['key'] : ''

  const opOptions = CRYPTO_OPS.map((o) => ({ text: o, label: t(`scenario.crypto.op.${o}`, o) }))

  const rows: ScenarioNodeCell[] = []

  if (cryptoOpNeedsInput(op)) {
    rows.push({
      id: 'value',
      label: t('scenario.crypto.value', 'value'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={STRING_VALUE_EXCLUDE}
            allowAllVariables
            dataTestId={`scn-crypto-value-${id}`}
            multilineLanguage="plaintext"
          />
        </div>
      )
    })
  }

  rows.push({
    id: 'operation',
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t('scenario.crypto.operation', 'operation')}</div>
        <SelectBox
          id={`scn-crypto-op-${id}`}
          className=""
          options={opOptions}
          selected={Math.max(0, CRYPTO_OPS.indexOf(op))}
          onDidSelect={(d: ISelectData) => { const next = CRYPTO_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
          data-testid="scn-crypto-op"
        />
      </div>
    )
  })

  if (cryptoOpNeedsKey(op)) {
    rows.push({
      id: 'key',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.crypto.key', 'key')}</div>
          <InputBox
            value={key}
            onChange={(next) => { data.onSetConfig?.(id, { key: next }) }}
            options={{ type: 'text', placeholder: t('scenario.crypto.keyPlaceholder', 'secret') }}
            data-testid="scn-crypto-key"
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.crypto.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
