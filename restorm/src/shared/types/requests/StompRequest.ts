import type { BaseRequest } from './BaseRequest'
import type { KeyValue } from '../baseTypes'

/** STOMP protocol version negotiated in the CONNECT frame. 1.0 is out of
 * scope (the spec's client-transaction-heavy 1.0 handshake is legacy). */
export type StompVersion = '1.1' | '1.2'

/** How the broker expects MESSAGE frames on this subscription to be
 * acknowledged: `auto` (the broker considers delivery == ack), `client`
 * (a single ACK/NACK cumulatively acks every earlier unacked message on the
 * subscription), `client-individual` (each message needs its own ACK/NACK). */
export type StompAckMode = 'auto' | 'client' | 'client-individual'

/** One SUBSCRIBE the connect handshake issues after CONNECTED. */
export interface StompSubscription {
  /** Subscription id (the `id` header) — MESSAGE frames on this subscription
   * carry it back so received frames can be attributed to it. */
  id: string
  destination: string
  ackMode: StompAckMode
}

export interface StompRequest extends BaseRequest {
  type: 'stomp'
  /** STOMP-over-WebSocket endpoint (`ws://` / `wss://`). */
  url: string
  stompVersion: StompVersion
  /** CONNECT frame headers (host, login, passcode, heart-beat, …). */
  connectHeaders: KeyValue[]
  /** SUBSCRIBEs issued right after CONNECTED. */
  subscriptions: StompSubscription[]
  /** Default destination for the Send button's SEND frame. */
  sendDestination: string
  /** Default body for the Send button's SEND frame. */
  sendBody: string
  /** Custom headers merged onto the SEND frame. */
  sendHeaders: KeyValue[]
}
