import type { ApiDocumentationSourceType } from '../../../../shared/types/apiDocumentation'

export interface ApiSourceFormatLogo {
  /** Path under `/imgs/import-sources/` ready to drop into an `<img src=…>`. */
  src: string
  /** `<img alt=…>` text; matches the user-facing label of the format. */
  alt: string
}

/* AsyncAPI ships no first-party logo under `restorm/assets/imgs/
 * import-sources/`; mapping it to `websocket.svg` was misleading
 * (AsyncAPI is the spec format, not the transport). The map keeps
 * `asyncapi` absent so `apiSourceFormatLogo` returns `undefined`
 * and the section quietly skips the image — until we drop a real
 * asyncapi.svg in the assets folder. */
const LOGOS: Partial<Record<ApiDocumentationSourceType, ApiSourceFormatLogo>> = {
  swagger: { src: '/imgs/import-sources/swagger.svg', alt: 'Swagger' },
  openapi: { src: '/imgs/import-sources/openapi.svg', alt: 'OpenAPI' },
  wsdl: { src: '/imgs/import-sources/soap.svg', alt: 'SOAP / WSDL' },
  grpc: { src: '/imgs/import-sources/grpc.svg', alt: 'gRPC' },
  graphql: { src: '/imgs/import-sources/graphql.svg', alt: 'GraphQL' },
  postman: { src: '/imgs/import-sources/postman.svg', alt: 'Postman' },
  insomnia: { src: '/imgs/import-sources/insomnia.svg', alt: 'Insomnia' },
  bruno: { src: '/imgs/import-sources/bruno.svg', alt: 'Bruno' },
  odata: { src: '/imgs/import-sources/odata.svg', alt: 'OData' }
}

export function apiSourceFormatLogo(sourceType: ApiDocumentationSourceType): ApiSourceFormatLogo | undefined {
  return LOGOS[sourceType]
}
