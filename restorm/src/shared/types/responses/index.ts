import type { BaseResponse, HTTPTimings, HTTPNetworkInfo } from './BaseResponse'
import type { HTTPResponse } from './HTTPResponse'
import type { GraphQLResponse } from './GraphQLResponse'
import type { GrpcResponse } from './GrpcResponse'
import type { SoapResponse } from './SoapResponse'
import type { WebSocketMessage, WebSocketResponse } from './WebSocketResponse'
import type { SseFrame, SseResponse } from './SseResponse'
import type { StompMessage, StompResponse } from './StompResponse'

export type { BaseResponse, HTTPTimings, HTTPNetworkInfo, HTTPResponse, GraphQLResponse, GrpcResponse, SoapResponse, WebSocketMessage, WebSocketResponse, SseFrame, SseResponse, StompMessage, StompResponse }

export type Response = HTTPResponse | GraphQLResponse | GrpcResponse | SoapResponse | WebSocketResponse | SseResponse | StompResponse
