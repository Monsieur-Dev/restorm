/**
 * The design's exportable DESCRIPTOR formats — the registry behind the
 * Settings export combo. One entry per emittable dialect; the first is
 * OpenAPI 3.1, the projection mechanics are shared with the served
 * /swagger.json (3.0) and future protocol descriptors reuse the same
 * shape (WSDL, OData CSDL, … — the multi-protocol ticket serves THESE
 * projections too). Deliberately intent-free: volumetry/PII and every
 * other design-only intention stays OUT of exported descriptors.
 */

import type { ApiDesign } from '../types/apiDesign'
import { designToApiDocumentation } from './apiDesignDoc'
import { apiDocumentationToOpenApi31 } from './openApiExport'
import { designToGraphqlSdl } from './graphqlProjection'
import { designToCsdl } from './odataProjection'
import { designToWsdl } from './soapProjection'

/** The served port the WSDL's `soap:address` points at when the design
 * declares none — mirrors the design server's default (main-side). */
const FALLBACK_SERVED_PORT = 4820

export interface DescriptorFormat {
  /** Stable id (persists nowhere yet — combo selection is ephemeral). */
  id: string
  /** i18n key of the combo label. */
  labelKey: string
  /** English fallback label (a dialect name — identical across locales). */
  label: string
  /** Extension of the downloaded file (no dot). */
  fileExtension: string
  /** Dialect infix of the default file name (`<design>.<fileSlug>.<ext>`)
   * — declarative, so new formats never edit the naming helper. */
  fileSlug: string
  /** Emit the design's descriptor as file content. */
  emit: (design: ApiDesign) => string
}

export const DESCRIPTOR_FORMATS: DescriptorFormat[] = [
  {
    id: 'openapi31',
    labelKey: 'design.export.format.openapi31',
    label: 'OpenAPI 3.1',
    fileExtension: 'json',
    fileSlug: 'openapi',
    emit: (design) => `${JSON.stringify(apiDocumentationToOpenApi31(designToApiDocumentation(design)), null, 2)}\n`
  },
  {
    id: 'graphql-sdl',
    labelKey: 'design.export.format.graphqlSdl',
    label: 'GraphQL SDL',
    fileExtension: 'graphql',
    fileSlug: 'schema',
    emit: (design) => designToGraphqlSdl(design)
  },
  {
    id: 'odata-csdl',
    labelKey: 'design.export.format.odataCsdl',
    label: 'OData CSDL',
    fileExtension: 'xml',
    fileSlug: 'metadata',
    emit: (design) => designToCsdl(design)
  },
  {
    id: 'wsdl',
    labelKey: 'design.export.format.wsdl',
    label: 'WSDL 1.1',
    fileExtension: 'wsdl',
    fileSlug: 'service',
    emit: (design) => designToWsdl(design, `http://localhost:${design.serving?.port ?? FALLBACK_SERVED_PORT}/soap`)
  }
]

/** Default file name of a design's exported descriptor. */
export function descriptorFileName(design: ApiDesign, format: DescriptorFormat): string {
  const slug = design.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'api-design'
  return `${slug}.${format.fileSlug}.${format.fileExtension}`
}
