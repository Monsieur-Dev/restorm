import { useIsRequestExecuting } from '../services/requestExecutingStore'
import { useIsWebsocketListening } from '../services/websocketListeningStore'
import { useIsSseListening } from '../services/sseListeningStore'
import { useIsAmqpListening } from '../services/amqpListeningStore'
import { useIsGrpcListening } from '../services/grpcListeningStore'
import { useIsGrpcServerListening } from '../services/grpcServerListeningStore'
import { useIsHttpListening } from '../services/httpListeningStore'
import { useIsSoapListening } from '../services/soapListeningStore'
import { useIsGraphqlListening } from '../services/graphqlListeningStore'
import { useIsODataListening } from '../services/odataListeningStore'
import { useIsStompListening } from '../services/stompListeningStore'
import { useIsGraphqlSubscribing } from '../services/graphqlSubscriptionListeningStore'
import { useIsDesignServerListening } from '../services/designServerStore'

/**
 * One activity truth per request, for every beam surface (send button,
 * sidebar badge, workbench tab badge): `true` while the request is
 * mid-execution (client in-flight, fed by `REQUEST_EXECUTION_*` events) OR
 * while it is listening (a mock/server host, or a long-lived client session —
 * WS/SIO/MQTT, SSE, gRPC stream, AMQP/STOMP subscribe, GraphQL subscription).
 *
 * A `requestId` belongs to exactly one protocol, so ORing every protocol's
 * listening store is safe — at most one is ever `true` for a given id.
 * A DESIGN id rides the same surfaces (its badge beams while its design
 * server is up) — design ids never collide with request ids.
 */
export function useIsRequestActive(requestId: string): boolean {
  const executing = useIsRequestExecuting(requestId)
  const wsListening = useIsWebsocketListening(requestId)
  const sseListening = useIsSseListening(requestId)
  const grpcListening = useIsGrpcListening(requestId)
  const grpcServerListening = useIsGrpcServerListening(requestId)
  const httpListening = useIsHttpListening(requestId)
  const soapListening = useIsSoapListening(requestId)
  const graphqlListening = useIsGraphqlListening(requestId)
  const odataListening = useIsODataListening(requestId)
  const amqpListening = useIsAmqpListening(requestId)
  const stompListening = useIsStompListening(requestId)
  const graphqlSubListening = useIsGraphqlSubscribing(requestId)
  const designServerListening = useIsDesignServerListening(requestId)
  return executing || wsListening || sseListening || grpcListening || grpcServerListening ||
    httpListening || soapListening || graphqlListening || odataListening || amqpListening ||
    stompListening || graphqlSubListening || designServerListening
}
