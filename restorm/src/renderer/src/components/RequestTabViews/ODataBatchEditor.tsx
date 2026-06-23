/**
 * ODataBatchEditor — structured editor for `$batch` sub-requests.
 *
 * Replaces the raw JSON textarea so users can add / reorder / remove
 * sub-requests, tag them with an atomicity group (change-set), and
 * edit the body in a Monaco editor. The serializer reads the
 * resulting array directly — no JSON string round-trip.
 */

import React, { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  CodeEditor,
  InputBox,
  SelectBox,
  type ISelectData,
  type ISelectOptionItem
} from 'electron-core-ui/renderer'
import type { ODataBatchSubRequestSpec, ODataBatchFormat } from '../../../../shared/types/collections'

const BATCH_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const
type BatchMethod = (typeof BATCH_METHODS)[number]

/** Wire-format options, in the SelectBox index order. */
const BATCH_FORMATS: ODataBatchFormat[] = ['multipart', 'json']

const rowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 8,
  border: '1px solid var(--panel-border)',
  borderRadius: 4,
  background: 'var(--sideBar-background)'
}
const labelStyle: CSSProperties = { fontSize: 12, color: 'var(--descriptionForeground)' }
const methodWrapperStyle: CSSProperties = { width: 100 }
const urlWrapperStyle: CSSProperties = { flex: 1, minWidth: 200 }
const groupWrapperStyle: CSSProperties = { width: 160 }
const buttonRowStyle: CSSProperties = { display: 'flex', gap: 4, marginLeft: 'auto' }
const bodyWrapperStyle: CSSProperties = {
  height: 140,
  border: '1px solid var(--input-border)',
  borderRadius: 4,
  boxSizing: 'border-box'
}

export interface ODataBatchEditorProps {
  value: readonly ODataBatchSubRequestSpec[]
  onChange: (next: ODataBatchSubRequestSpec[]) => void
  /** Current `$batch` wire format. Defaults to `'multipart'`. */
  format?: ODataBatchFormat
  /** Called when the user switches the wire format. */
  onFormatChange?: (next: ODataBatchFormat) => void
}

function newSubRequest(): ODataBatchSubRequestSpec {
  return {
    id: crypto.randomUUID(),
    method: 'GET',
    url: ''
  }
}

export const ODataBatchEditor: React.FC<ODataBatchEditorProps> = ({ value, onChange, format = 'multipart', onFormatChange }) => {
  const { t } = useTranslation()
  const methodOptions: ISelectOptionItem[] = BATCH_METHODS.map((m) => ({ text: m }))
  const formatOptions: ISelectOptionItem[] = [
    { text: t('odataRequestTab.batchFormatMultipart', 'multipart/mixed') },
    { text: t('odataRequestTab.batchFormatJson', 'JSON batch') }
  ]
  const formatIndex = Math.max(0, BATCH_FORMATS.indexOf(format))

  const update = (index: number, patch: Partial<ODataBatchSubRequestSpec>): void => {
    const next = value.slice()
    const current = next[index]
    if (!current) return
    next[index] = { ...current, ...patch }
    onChange(next)
  }

  const clearAtomicityGroup = (index: number): void => {
    const next = value.slice()
    const current = next[index]
    if (!current) return
    const { atomicityGroup: _removed, ...rest } = current
    next[index] = rest
    onChange(next)
  }

  const remove = (index: number): void => {
    const next = value.slice()
    next.splice(index, 1)
    onChange(next)
  }

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= value.length) return
    const next = value.slice()
    const [item] = next.splice(index, 1)
    if (!item) return
    next.splice(target, 0, item)
    onChange(next)
  }

  const add = (): void => {
    onChange([...value, newSubRequest()])
  }

  const hasBody = (method: string): boolean => ['POST', 'PATCH', 'PUT'].includes(method.toUpperCase())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="odata-batch-editor">
      <div style={rowStyle}>
        <span style={labelStyle}>{t('odataRequestTab.batchFormatLabel', 'Batch format')}</span>
        <div style={groupWrapperStyle}>
          <SelectBox
            id="odata-batch-format"
            className=""
            options={formatOptions}
            selected={formatIndex}
            onDidSelect={(data: ISelectData) => {
              const next = BATCH_FORMATS[data.index]
              if (next && onFormatChange) onFormatChange(next)
            }}
            data-testid="odata-batch-format"
          />
        </div>
      </div>

      {value.length === 0 ? (
        <span style={{ ...labelStyle, fontStyle: 'italic' }}>
          {t('odataRequestTab.batchEmpty', 'No sub-requests yet. Add one below.')}
        </span>
      ) : null}

      {value.map((sub, index) => {
        const methodIndex = Math.max(0, BATCH_METHODS.indexOf(sub.method.toUpperCase() as BatchMethod))
        return (
          <div key={sub.id} style={cardStyle} data-testid={`odata-batch-sub-${index}`}>
            <div style={rowStyle}>
              <div style={methodWrapperStyle}>
                <SelectBox
                  id={`odata-batch-method-${index}`}
                  className=""
                  options={methodOptions}
                  selected={methodIndex}
                  onDidSelect={(data: ISelectData) => {
                    const next = BATCH_METHODS[data.index]
                    if (next) update(index, { method: next })
                  }}
                  data-testid={`odata-batch-method-${index}`}
                />
              </div>
              <div style={urlWrapperStyle}>
                <InputBox
                  value={sub.url}
                  onChange={(url: string) => { update(index, { url }) }}
                  options={{ placeholder: t('odataRequestTab.batchUrlPlaceholder', 'Pets(1) — relative to service root') }}
                  data-testid={`odata-batch-url-${index}`}
                />
              </div>
              <div style={groupWrapperStyle}>
                <InputBox
                  value={sub.atomicityGroup ?? ''}
                  onChange={(atomicityGroup: string) => {
                    if (atomicityGroup) {
                      update(index, { atomicityGroup })
                    } else {
                      clearAtomicityGroup(index)
                    }
                  }}
                  options={{ placeholder: t('odataRequestTab.batchAtomicityPlaceholder', 'change-set (optional)') }}
                  data-testid={`odata-batch-group-${index}`}
                />
              </div>
              <div style={buttonRowStyle}>
                <Button
                  icon="chevron-up"
                  onClick={() => { move(index, -1) }}
                  options={{
                    ariaLabel: t('odataRequestTab.batchMoveUp', 'Move up'),
                    title: t('odataRequestTab.batchMoveUp', 'Move up')
                  }}
                  data-testid={`odata-batch-move-up-${index}`}
                  disabled={index === 0}
                />
                <Button
                  icon="chevron-down"
                  onClick={() => { move(index, 1) }}
                  options={{
                    ariaLabel: t('odataRequestTab.batchMoveDown', 'Move down'),
                    title: t('odataRequestTab.batchMoveDown', 'Move down')
                  }}
                  data-testid={`odata-batch-move-down-${index}`}
                  disabled={index === value.length - 1}
                />
                <Button
                  icon="trash"
                  onClick={() => { remove(index) }}
                  options={{
                    ariaLabel: t('odataRequestTab.batchRemove', 'Remove sub-request'),
                    title: t('odataRequestTab.batchRemove', 'Remove sub-request')
                  }}
                  data-testid={`odata-batch-remove-${index}`}
                />
              </div>
            </div>
            {hasBody(sub.method) ? (
              <div>
                <span style={labelStyle}>{t('odataRequestTab.batchBodyLabel', 'Body (JSON)')}</span>
                <div style={bodyWrapperStyle}>
                  <CodeEditor
                    height="100%"
                    language="json"
                    value={sub.body ?? ''}
                    onChange={(nextBody) => { update(index, { body: nextBody ?? '' }) }}
                    options={{
                      minimap: { enabled: false },
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true
                    }}
                    data-testid={`odata-batch-body-${index}`}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )
      })}

      <div>
        <Button
          icon="add"
          onClick={add}
          options={{
            ariaLabel: t('odataRequestTab.batchAdd', 'Add sub-request'),
            title: t('odataRequestTab.batchAdd', 'Add sub-request')
          }}
          data-testid="odata-batch-add"
        >
          {t('odataRequestTab.batchAdd', 'Add sub-request')}
        </Button>
      </div>

      <span style={{ ...labelStyle, fontStyle: 'italic' }}>
        {t(
          'odataRequestTab.batchGroupHint',
          'Consecutive sub-requests sharing the same change-set label are serialized inside one atomic multipart/mixed envelope — use them for transactional writes.'
        )}
      </span>
    </div>
  )
}
