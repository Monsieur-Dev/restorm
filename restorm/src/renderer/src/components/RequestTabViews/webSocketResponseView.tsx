import type { ReactNode } from 'react'
import { ScrollableElement } from 'electron-core-ui/renderer'
import type { TFunction } from 'i18next'
import type { WebSocketMessage, WebSocketResponse } from '../../../../shared/types/collections'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { buildCookiesContent } from './HTTPResponsePanel'
import './WebSocketChat.css'

/**
 * The WebSocket / Socket.IO / MQTT response view — the chat of sent and
 * received frames (acks folded onto their sent bubble) and the Infos block —
 * as pure builders shared by the request tab and the recording captures pane.
 */

export function renderWebSocketChat(messages: WebSocketMessage[], protocol: string | undefined, t: TFunction): ReactNode {
    interface ChatItem { direction: 'sent' | 'received'; data: string; event: string | undefined; acknowledged: boolean }
    const items: ChatItem[] = []
    const isMqtt = protocol === 'mqtt'
    for (const msg of messages) {
      const ackMatch = msg.direction === 'received' && msg.event ? /^(.*) \(ack\)$/.exec(msg.event) : null
      if (ackMatch) {
        const baseEvent = ackMatch[1]
        for (let j = items.length - 1; j >= 0; j--) {
          const candidate = items[j]
          if (candidate?.direction === 'sent' && !candidate.acknowledged && (candidate.event ?? '') === baseEvent) {
            candidate.acknowledged = true
            break
          }
        }
        continue
      }
      // MQTT round-trip: a received frame matching a still-unconfirmed sent
      // bubble (same payload — and same topic when the sent frame recorded one)
      // is that publish coming back via the subscription. Fold it into a
      // delivery check instead of a duplicate inbound bubble. The payload is the
      // round-trip identity; a sent bubble that didn't record its topic still
      // matches (publishes always go to the request's own topic).
      if (isMqtt && msg.direction === 'received') {
        const match = items.find(
          (c) =>
            c.direction === 'sent' &&
            !c.acknowledged &&
            c.data === msg.data &&
            (!c.event || c.event === msg.event)
        )
        if (match) { match.acknowledged = true; continue }
      }
      items.push({ direction: msg.direction, data: msg.data, event: msg.event, acknowledged: false })
    }
    if (items.length === 0) {
      return <div className="ws-chat-empty">{t('websocket.noMessages')}</div>
    }
    return (
      <ScrollableElement
        options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
        style={{ flex: 1, minHeight: 0 }}
      >
        <div className="ws-chat" data-testid="websocket-chat">
        {items.map((item, i) => (
          <div
            key={i}
            className={`ws-chat-bubble ${item.direction === 'sent' ? 'sent' : 'received'}`}
            data-testid="ws-chat-bubble"
            data-direction={item.direction}
          >
            {item.direction === 'sent' && item.acknowledged && (
              <HeaderHoverTooltip label={t('websocket.acknowledged')} placement="above" className="ws-chat-ack-check">
                <span className="codicon codicon-pass-filled" aria-label={t('websocket.acknowledged')} data-testid="ws-chat-ack-check" />
              </HeaderHoverTooltip>
            )}
            {item.event && <span className="ws-chat-event">{item.event}</span>}
            {item.data}
          </div>
        ))}
        </div>
      </ScrollableElement>
    )
}

export interface WebSocketResponseViewMeta {
  protocol?: string | undefined
  event?: string | undefined
}

export function buildWebSocketResponseView(
  resp: WebSocketResponse | null,
  meta: WebSocketResponseViewMeta | undefined,
  t: TFunction
): { infosContent: ReactNode | null; responseContent: ReactNode | null; cookiesContent: ReactNode | null; jsonData: unknown } {
    if (!resp) return { infosContent: null, responseContent: null, cookiesContent: null, jsonData: undefined }
    const infosContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.connected ? t('websocket.connected') : t('websocket.disconnected')}
          </span>
        </div>
        {resp.timings.durationMs > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
            <span>{resp.timings.durationMs}ms</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Protocol:</span>
          <span>{meta?.protocol ?? '-'}</span>
        </div>
        {meta?.event && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Event:</span>
            <span>{meta.event}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Messages:</span>
          <span>{resp.messages.length}</span>
        </div>
        {resp.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
              {resp.error}
            </div>
          </div>
        )}
      </div>
    )

    return { infosContent, responseContent: renderWebSocketChat(resp.messages, meta?.protocol, t), cookiesContent: buildCookiesContent(resp), jsonData: undefined }
}
