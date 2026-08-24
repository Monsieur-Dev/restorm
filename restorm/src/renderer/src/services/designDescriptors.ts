import type { ApiDesign, DesignProtocol } from '../../../shared/types/collections'
import { designToApiDocumentation, composeRoutePath, ensureLeadingSlash } from '../../../shared/design/apiDesignDoc'
import { apiDocumentationToOpenApi } from '../../../shared/design/openApiExport'
import { designToGraphqlSdl } from '../../../shared/design/graphqlProjection'
import { designToProto } from '../../../shared/design/grpcProjection'
import { designToCsdl } from '../../../shared/design/odataProjection'
import { designToWsdl } from '../../../shared/design/soapProjection'

/**
 * A live descriptor a served design exposes for one protocol: the resolved URL
 * (or gRPC reflection address) to copy, and the descriptor CONTENT — computed
 * locally from the design with the SAME projections the server serves, so no
 * fetch (and no CSP / firewall round-trip) is needed to preview it.
 */
export interface DesignDescriptor {
  protocol: DesignProtocol
  /** Full resolved URL, or `host:port` for the gRPC reflection service. */
  url: string
  /** Monaco language id for the content editor. */
  language: string
  content: string
}

/**
 * Every active descriptor for a served design — one per enabled protocol (HTTP
 * always on). `resolvedBasePath` is the env-resolved, slash-rooted base path
 * (so the HTTP descriptor URL reads like the served `/api/v1/swagger.json`).
 */
export function designDescriptors(
  design: ApiDesign,
  port: number,
  grpcPort: number | undefined,
  resolvedBasePath: string
): DesignDescriptor[] {
  const enabled = new Set<DesignProtocol>(['http', ...(design.serving?.protocols ?? [])])
  const base = `http://127.0.0.1:${String(port)}`
  const out: DesignDescriptor[] = []
  if (enabled.has('http')) {
    out.push({
      protocol: 'http',
      url: `${base}${composeRoutePath({ designBasePath: ensureLeadingSlash(resolvedBasePath) }, 'swagger.json')}`,
      language: 'json',
      content: `${JSON.stringify(apiDocumentationToOpenApi(designToApiDocumentation(design)), null, 2)}\n`
    })
  }
  if (enabled.has('graphql')) {
    out.push({ protocol: 'graphql', url: `${base}/graphql`, language: 'graphql', content: designToGraphqlSdl(design) })
  }
  if (enabled.has('soap')) {
    out.push({ protocol: 'soap', url: `${base}/soap?wsdl`, language: 'xml', content: designToWsdl(design, `${base}/soap`) })
  }
  if (enabled.has('odata')) {
    out.push({ protocol: 'odata', url: `${base}/odata/$metadata`, language: 'xml', content: designToCsdl(design) })
  }
  if (enabled.has('grpc') && grpcPort !== undefined) {
    out.push({ protocol: 'grpc', url: `127.0.0.1:${String(grpcPort)}`, language: 'proto', content: designToProto(design) })
  }
  return out
}
