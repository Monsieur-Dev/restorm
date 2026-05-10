import { describe, it, expect } from 'vitest'
import { detectWireProtocol } from './protocolDetect'

describe('detectWireProtocol', () => {
	it('keeps base scheme for plain HTTP without signals', () => {
		expect(detectWireProtocol({ url: 'http://example.com/api/users', headers: {}, baseProtocol: 'http' })).toBe('http')
	})

	it('detects gRPC by content-type', () => {
		expect(
			detectWireProtocol({ url: 'http://api.example.com/Service/Method', headers: { 'content-type': 'application/grpc' }, baseProtocol: 'http' })
		).toBe('grpc')
		expect(
			detectWireProtocol({ url: 'http://api.example.com/Service/Method', headers: { 'content-type': 'application/grpc+proto; charset=utf-8' }, baseProtocol: 'http' })
		).toBe('grpc')
	})

	it('detects GraphQL by URL path', () => {
		expect(detectWireProtocol({ url: 'https://api.example.com/graphql', headers: {}, baseProtocol: 'https' })).toBe('graphql')
		expect(detectWireProtocol({ url: 'https://api.example.com/v1/graphql', headers: {}, baseProtocol: 'https' })).toBe('graphql')
	})

	it('detects GraphQL by Content-Type', () => {
		expect(
			detectWireProtocol({ url: 'http://x/q', headers: { 'content-type': 'application/graphql' }, baseProtocol: 'http' })
		).toBe('graphql')
	})

	it('detects GraphQL by JSON body shape', () => {
		expect(
			detectWireProtocol({
				url: 'http://x/api',
				headers: { 'content-type': 'application/json' },
				body: '{"query":"query Q { me { id } }"}',
				baseProtocol: 'http'
			})
		).toBe('graphql')
		expect(
			detectWireProtocol({
				url: 'http://x/api',
				headers: { 'content-type': 'application/json' },
				body: '{"operationName":"Q","variables":{}}',
				baseProtocol: 'http'
			})
		).toBe('graphql')
	})

	it('rejects GraphQL when body is JSON without query/mutation/subscription/operationName', () => {
		expect(
			detectWireProtocol({
				url: 'http://x/api',
				headers: { 'content-type': 'application/json' },
				body: '{"foo":"bar"}',
				baseProtocol: 'http'
			})
		).toBe('http')
	})

	it('detects SOAP by content-type + envelope body', () => {
		expect(
			detectWireProtocol({
				url: 'http://soap/svc',
				headers: { 'content-type': 'application/soap+xml' },
				body: '<soapenv:Envelope xmlns:soapenv="…"></soapenv:Envelope>',
				baseProtocol: 'http'
			})
		).toBe('soap')
	})

	it('does not call text/xml SOAP without an envelope', () => {
		expect(
			detectWireProtocol({
				url: 'http://x/svc',
				headers: { 'content-type': 'text/xml' },
				body: '<root>hi</root>',
				baseProtocol: 'http'
			})
		).toBe('http')
	})

	it('detects OData by $metadata path', () => {
		expect(detectWireProtocol({ url: 'http://o/data/$metadata', headers: {}, baseProtocol: 'http' })).toBe('odata')
		expect(detectWireProtocol({ url: 'http://o/data/$batch', headers: {}, baseProtocol: 'http' })).toBe('odata')
	})

	it('detects OData by query parameters', () => {
		expect(detectWireProtocol({ url: 'http://o/data/Pets?$filter=age gt 5', headers: {}, baseProtocol: 'http' })).toBe('odata')
		expect(detectWireProtocol({ url: 'http://o/data/Pets?$top=10&$select=id,name', headers: {}, baseProtocol: 'http' })).toBe('odata')
	})

	it('preserves websocket protocol', () => {
		expect(detectWireProtocol({ url: 'ws://x/socket', headers: {}, baseProtocol: 'websocket' })).toBe('websocket')
	})

	it('preserves internal protocol unchanged', () => {
		expect(detectWireProtocol({ url: 'http://localhost:9999/graphql', headers: {}, baseProtocol: 'internal' })).toBe('internal')
	})

	it('handles malformed URLs without throwing', () => {
		expect(detectWireProtocol({ url: 'not a real url', headers: {}, baseProtocol: 'http' })).toBe('http')
	})
})
