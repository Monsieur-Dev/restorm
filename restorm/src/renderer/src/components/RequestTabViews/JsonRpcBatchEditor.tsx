/**
 * JsonRpcBatchEditor — structured editor for `jsonrpc-batch` child calls.
 *
 * Mirrors the `ODataBatchEditor` pattern (add / reorder / remove child
 * rows, each with its own body editor) trimmed to what a JSON-RPC batch
 * actually needs: no atomicity groups (the spec's batch array has no
 * transactional semantics), just N independent `{ method, params, id }`
 * calls composed into one POST.
 */

import React, { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, CodeEditor, InputBox, Toggle } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import type { JsonRpcBatchCallSpec } from '../../../../shared/types/collections'

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
const methodWrapperStyle: CSSProperties = { flex: 1, minWidth: 160 }
const idWrapperStyle: CSSProperties = { width: 140 }
const buttonRowStyle: CSSProperties = { display: 'flex', gap: 4, marginLeft: 'auto' }
const paramsWrapperStyle: CSSProperties = {
  height: 100,
  border: '1px solid var(--input-border)',
  borderRadius: 4,
  boxSizing: 'border-box'
}

export interface JsonRpcBatchEditorProps {
  value: readonly JsonRpcBatchCallSpec[]
  onChange: (next: JsonRpcBatchCallSpec[]) => void
}

function newChild(): JsonRpcBatchCallSpec {
  return { childId: crypto.randomUUID(), method: '', params: '', rpcId: '' }
}

export const JsonRpcBatchEditor: React.FC<JsonRpcBatchEditorProps> = ({ value, onChange }) => {
  const { t } = useTranslation()

  const update = (index: number, patch: Partial<JsonRpcBatchCallSpec>): void => {
    const next = value.slice()
    const current = next[index]
    if (!current) return
    next[index] = { ...current, ...patch }
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
    onChange([...value, newChild()])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }} data-testid="jsonrpc-batch-editor">
      {value.length === 0 ? (
        <span style={{ ...labelStyle, fontStyle: 'italic' }}>
          {t('jsonrpcBatch.empty', 'No calls yet. Add one below.')}
        </span>
      ) : null}

      {value.map((child, index) => (
        <div key={child.childId} style={cardStyle} data-testid={`jsonrpc-batch-child-${index}`}>
          <div style={rowStyle}>
            <div style={methodWrapperStyle}>
              <InputBox
                value={child.method}
                onChange={(method: string) => { update(index, { method }) }}
                options={{ placeholder: t('jsonrpcBatch.methodPlaceholder', 'method') }}
                data-testid={`jsonrpc-batch-method-${index}`}
              />
            </div>
            <div style={idWrapperStyle}>
              <InputBox
                value={child.rpcId}
                onChange={(rpcId: string) => { update(index, { rpcId }) }}
                options={{ placeholder: t('jsonrpcBatch.idPlaceholder', 'id (auto)') }}
                disabled={child.notificationMode === true}
                data-testid={`jsonrpc-batch-id-${index}`}
              />
            </div>
            <HeaderHoverTooltip
              label={t('jsonrpc.notificationModeTooltip', 'Notification mode — no id, no response awaited')}
              data-testid={`jsonrpc-batch-notification-tooltip-${index}`}
            >
              <Toggle
                checked={child.notificationMode === true}
                onChange={(v) => { update(index, { notificationMode: v }) }}
                data-testid={`jsonrpc-batch-notification-${index}`}
              />
            </HeaderHoverTooltip>
            <div style={buttonRowStyle}>
              <Button
                icon="chevron-up"
                onClick={() => { move(index, -1) }}
                options={{
                  ariaLabel: t('jsonrpcBatch.moveUp', 'Move up'),
                  title: t('jsonrpcBatch.moveUp', 'Move up')
                }}
                data-testid={`jsonrpc-batch-move-up-${index}`}
                disabled={index === 0}
              />
              <Button
                icon="chevron-down"
                onClick={() => { move(index, 1) }}
                options={{
                  ariaLabel: t('jsonrpcBatch.moveDown', 'Move down'),
                  title: t('jsonrpcBatch.moveDown', 'Move down')
                }}
                data-testid={`jsonrpc-batch-move-down-${index}`}
                disabled={index === value.length - 1}
              />
              <Button
                icon="trash"
                onClick={() => { remove(index) }}
                options={{
                  ariaLabel: t('jsonrpcBatch.remove', 'Remove call'),
                  title: t('jsonrpcBatch.remove', 'Remove call')
                }}
                data-testid={`jsonrpc-batch-remove-${index}`}
              />
            </div>
          </div>
          <div>
            <span style={labelStyle}>{t('jsonrpcBatch.paramsLabel', 'Params (JSON)')}</span>
            <div style={paramsWrapperStyle}>
              <CodeEditor
                height="100%"
                language="json"
                value={child.params}
                onChange={(nextParams) => { update(index, { params: nextParams ?? '' }) }}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true
                }}
                data-testid={`jsonrpc-batch-params-${index}`}
              />
            </div>
          </div>
        </div>
      ))}

      <div>
        <Button
          icon="add"
          onClick={add}
          options={{
            ariaLabel: t('jsonrpcBatch.add', 'Add call'),
            title: t('jsonrpcBatch.add', 'Add call')
          }}
          data-testid="jsonrpc-batch-add"
        >
          {t('jsonrpcBatch.add', 'Add call')}
        </Button>
      </div>
    </div>
  )
}
