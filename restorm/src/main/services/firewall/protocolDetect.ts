import type { RequestRecordProtocol } from '../../../shared/types/firewall'

/**
 * Best-effort wire-protocol classifier. Both interception layers fall
 * back to `http` / `https` / `websocket` based on the URL scheme alone;
 * this helper bumps the record up one level when the request looks
 * like GraphQL / SOAP / OData / gRPC so the console's per-protocol
 * formatter (`renderHttpCurl` vs `renderGrpcCurl` vs …) can take
 * over and produce the right tool's command line.
 *
 * Detection is conservative: we only upgrade when we see strong
 * positive signals (matching content-type, well-known URL suffix,
 * JSON body starting with `{"query":`). Anything ambiguous stays
 * on the base scheme — the curl renderer there is already correct.
 */

const GRPC_CONTENT_TYPES = new Set<string>([
	'application/grpc',
	'application/grpc+proto',
	'application/grpc+json'
])

const SOAP_CONTENT_TYPES = new Set<string>([
	'application/soap+xml',
	'text/xml'
])

const ODATA_QUERY_PARAMS = ['$metadata', '$filter', '$expand', '$select', '$orderby', '$top', '$skip', '$count', '$format', '$search']

const GRAPHQL_PATH_SUFFIXES = ['/graphql', '/api/graphql', '/v1/graphql']

interface DetectInput {
	url: string
	headers: Record<string, string>
	body?: string
	baseProtocol: RequestRecordProtocol
}

export function detectWireProtocol(input: DetectInput): RequestRecordProtocol {
	if (input.baseProtocol === 'websocket' || input.baseProtocol === 'internal') return input.baseProtocol

	const contentType = (input.headers['content-type'] ?? '').toLowerCase().split(';')[0]?.trim() ?? ''

	if (contentType !== '' && GRPC_CONTENT_TYPES.has(contentType)) return 'grpc'
	if (contentType !== '' && SOAP_CONTENT_TYPES.has(contentType) && bodyLooksSoap(input.body)) return 'soap'

	if (looksLikeGraphql(input.url, contentType, input.body)) return 'graphql'
	if (looksLikeOdata(input.url)) return 'odata'

	return input.baseProtocol
}

function looksLikeGraphql(url: string, contentType: string, body: string | undefined): boolean {
	if (contentType === 'application/graphql') return true
	let parsed: URL | null = null
	try { parsed = new URL(url) } catch { /* malformed — fall through */ }
	const path = parsed !== null ? parsed.pathname.toLowerCase() : url.toLowerCase()
	if (GRAPHQL_PATH_SUFFIXES.some((s) => path === s || path.endsWith(s))) return true
	if (contentType === 'application/json' && bodyLooksGraphql(body)) return true
	return false
}

function bodyLooksGraphql(body: string | undefined): boolean {
	if (body === undefined || body.length === 0) return false
	const trimmed = body.trim()
	if (!trimmed.startsWith('{')) return false
	// Cheap structural test — skip a full JSON.parse on every record:
	// an `operationName` / `query` / `mutation` / `subscription` key
	// at the top level is the GraphQL HTTP transport contract.
	return /"(?:query|mutation|subscription|operationName)"\s*:/.test(trimmed)
}

function looksLikeOdata(url: string): boolean {
	let parsed: URL | null = null
	try { parsed = new URL(url) } catch { return false }
	const path = parsed.pathname.toLowerCase()
	if (path.endsWith('/$metadata') || path.endsWith('/$batch')) return true
	for (const param of ODATA_QUERY_PARAMS) {
		if (parsed.searchParams.has(param)) return true
	}
	return false
}

function bodyLooksSoap(body: string | undefined): boolean {
	if (body === undefined || body.length === 0) return false
	const trimmed = body.trim().slice(0, 512).toLowerCase()
	return trimmed.includes(':envelope') || trimmed.includes('<soapenv:envelope') || trimmed.includes('<soap:envelope')
}
