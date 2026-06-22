import type { BaseRequest } from './BaseRequest'
import type { KeyValue } from '../baseTypes'

/** One operation a hosted SOAP mock answers. The inbound request is matched to
 * an operation by its `SOAPAction` header (when set) or the first child element
 * under `<soap:Body>`; the mock then replies with `responseBody` wrapped in a
 * SOAP envelope (an `isFault` operation replies with a `<soap:Fault>` + HTTP
 * 500). */
export interface SoapMockOperation {
  /** The local operation name (matches the first child of `<soap:Body>`). */
  name: string
  /** Optional `SOAPAction` header to match on (takes precedence over `name`). */
  soapAction?: string
  /** The XML the mock returns — the inner body content (an envelope is wrapped
   * around it) or, for a fault, the `<soap:Fault>` content. */
  responseBody: string
  /** When true, this operation answers with a `<soap:Fault>` + HTTP 500. */
  isFault?: boolean
}

export interface SoapRequest extends BaseRequest {
  type: 'soap'
  url: string
  soapAction: string
  service: string
  operation: string
  body: string
  headers: KeyValue[]
  /** When true, restorm HOSTS a SOAP mock server on `localhost:<port>[/<route>]`
   * (host fixed) instead of calling out as a client. */
  server?: boolean | undefined
  /** Operations the hosted mock answers (server mode). */
  mockOperations?: SoapMockOperation[] | undefined
}
