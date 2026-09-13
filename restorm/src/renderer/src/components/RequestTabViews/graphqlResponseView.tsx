import type { ReactNode } from 'react'
import { CodeEditor } from 'electron-core-ui/renderer'
import type { GraphQLResponse } from '../../../../shared/types/collections'
import { buildCookiesContent } from './HTTPResponsePanel'

/**
 * The GraphQL response view — Infos block + read-only JSON body + graph data
 * — as a pure builder shared by the request tab and the recording captures
 * pane.
 */
export function buildGraphqlResponseView(resp: GraphQLResponse | null): { infosContent: ReactNode | null; responseContent: ReactNode | null; cookiesContent: ReactNode | null; jsonData: unknown } {
    const infosContent = resp ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.statusCode >= 200 && resp.statusCode < 300 ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.statusCode}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span>{resp.timings.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>URL:</span>
          <span style={{ wordBreak: 'break-all' }}>{resp.requestUrl}</span>
        </div>
        {resp.errors && resp.errors.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Errors:</span>
            {resp.errors.map((err, i) => (
              <div key={i} style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
                {err.message}
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null

    // Surface any response payload: successful data, GraphQL errors[], or a
    // transport-level error string (network failure, cancellation).
    const responseJson = resp
      ? JSON.stringify(
          resp.error
            ? { error: resp.error }
            : { data: resp.data, errors: resp.errors },
          null,
          2
        )
      : null
    const responseContent = resp && (resp.data ?? resp.errors ?? resp.error) ? (
      <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
        <CodeEditor
          height="100%"
          language="json"
          value={responseJson ?? ''}
          options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
          data-testid="graphql-response-editor"
        />
      </div>
    ) : null

    return { infosContent, responseContent, cookiesContent: buildCookiesContent(resp), jsonData: resp ? { data: resp.data, errors: resp.errors } : undefined }
}
