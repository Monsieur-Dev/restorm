import type { BaseResponse, HTTPTimings, HTTPNetworkInfo } from './BaseResponse'
import type { HTTPResponse } from './HTTPResponse'
import type { GraphQLResponse } from './GraphQLResponse'
import type { GrpcResponse } from './GrpcResponse'
import type { SoapResponse } from './SoapResponse'
import type { WebSocketMessage, WebSocketResponse } from './WebSocketResponse'

export type { BaseResponse, HTTPTimings, HTTPNetworkInfo, HTTPResponse, GraphQLResponse, GrpcResponse, SoapResponse, WebSocketMessage, WebSocketResponse }

export type Response = HTTPResponse | GraphQLResponse | GrpcResponse | SoapResponse | WebSocketResponse
