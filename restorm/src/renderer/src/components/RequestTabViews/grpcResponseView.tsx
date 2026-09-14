import type { ReactNode } from 'react'
import { CodeEditor } from 'electron-core-ui/renderer'
import type { GrpcResponse } from '../../../../shared/types/collections'

/**
 * The gRPC response view — Infos block (status, service, method, call type)
 * + read-only JSON message + graph data — as a pure builder shared by the
 * request tab and the recording captures pane.
 */
export interface GrpcResponseViewMeta {
  service?: string
  method?: string
  callType?: string
}

export function buildGrpcResponseView(
  resp: GrpcResponse | null,
  meta?: GrpcResponseViewMeta
): { infosContent: ReactNode | null; responseContent: ReactNode | null; jsonData: unknown } {
    const infosContent = resp ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span
            data-testid="grpc-response-status"
            data-status-code={resp.statusCode}
            data-status-message={resp.statusMessage}
            style={{ color: resp.statusCode === 0 ? 'var(--testing-iconPassed)' : 'var(--editorWarning-foreground)' }}
          >
            {resp.statusCode} ({resp.statusCode === 0 ? 'OK' : 'Error'})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span>{resp.timings.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Service:</span>
          <span>{meta?.service ?? '-'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Method:</span>
          <span>{meta?.method ?? '-'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Call Type:</span>
          <span>{meta?.callType ?? '-'}</span>
        </div>
        {resp.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
            <div
              data-testid="grpc-response-error"
              style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}
            >
              {resp.error}
            </div>
          </div>
        )}
      </div>
    ) : null

    const responseContent = resp?.responseMessage ? (
      <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
        <CodeEditor
          height="100%"
          language="json"
          value={resp.responseMessage}
          options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
          data-testid="grpc-response-message-editor"
        />
      </div>
    ) : null

    const jsonData = (() => {
      if (!resp?.responseMessage) return undefined
      try {
        return JSON.parse(resp.responseMessage) as unknown
      } catch {
        return undefined
      }
    })()

    return { infosContent, responseContent, jsonData }
}
