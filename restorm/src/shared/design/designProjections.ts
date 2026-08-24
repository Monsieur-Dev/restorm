/**
 * How a single design route is exposed across the protocols the design can
 * serve. The engine ALREADY projects every route onto GraphQL / gRPC / SOAP /
 * OData automatically (from the method, path and model bindings) — this just
 * reads those projections back for ONE route, so the operation editor can show
 * the user what their route becomes in each protocol. Pure + read-only: no new
 * data model, it reuses the same projection functions the served endpoints do.
 */

import type { ApiDesign, DesignRoute, DesignRouteGroup } from '../types/apiDesign'
import { composeRoutePath } from './apiDesignDoc'
import { routePathParams } from './designRoutes'
import { resolveUrlAgainstEnv } from '../utils/resolveUrlAgainstEnv'
import { designGraphqlOperations } from './graphqlProjection'
import { designGrpcMethods, designProtoServiceName } from './grpcProjection'
import { designSoapOperations } from './soapProjection'
import { designODataEntitySets } from './odataProjection'

/**
 * Resolve `{{baseUrl}}`-style handlebars in a composed design path against the
 * environment, then collapse the duplicate slashes that appear when a resolved
 * base value carries its own leading slash (env `baseRoute = /api/v1` turns the
 * `/{{baseRoute}}/…` template into `//api/v1/…`). The mock server serves the
 * single-slash form, so this makes the preview match what's actually served.
 * Scheme separators (`://`) are preserved; path-params like `{{id}}` aren't in
 * the env map, so they stay as placeholders.
 */
export function resolveDesignPath(path: string, envVars: Record<string, string>): string {
  return resolveUrlAgainstEnv(path, envVars).replace(/(?<!:)\/{2,}/g, '/')
}

export interface RouteProjections {
  /** Always present — the design IS an HTTP API first. */
  http: string
  /** `null` when the route doesn't project onto that protocol. */
  graphql: string | null
  grpc: string | null
  soap: string | null
  odata: string | null
}

/**
 * The compact per-protocol signature of a single route. Pass `envVars` (the
 * flattened environment-folder map) to resolve `{{baseUrl}}`-style handlebars
 * in the HTTP path against the environment — path-params like `{{id}}` aren't
 * in the map, so they're left as placeholders.
 */
export function designRouteProjections(
  design: ApiDesign,
  group: DesignRouteGroup,
  route: DesignRoute,
  envVars: Record<string, string> = {}
): RouteProjections {
  const method = (route.doc.match.method ?? 'GET').toUpperCase()
  const httpPath = resolveDesignPath(composeRoutePath({
    ...(design.server?.basePath !== undefined ? { designBasePath: design.server.basePath } : {}),
    ...(group.design?.versionPrefix !== undefined ? { versionPrefix: group.design.versionPrefix } : {}),
    ...(group.design?.basePath !== undefined ? { groupBasePath: group.design.basePath } : {})
  }, route.doc.match.urlPattern), envVars)

  const gqlOp = designGraphqlOperations(design).find((o) => o.route === route)
  const graphql = gqlOp !== undefined
    ? `${gqlOp.kind} ${gqlOp.fieldName}${gqlOp.args.length > 0 ? `(${gqlOp.args.map(([n, t]) => `${n}: ${t}`).join(', ')})` : ''}: ${gqlOp.returnType}`
    : null

  const grpcOp = designGrpcMethods(design).find((o) => o.route === route)
  const grpc = grpcOp !== undefined
    ? `rpc ${designProtoServiceName(design)}/${grpcOp.name} (${grpcOp.requestType}) returns (${grpcOp.responseType})`
    : null

  const soapOp = designSoapOperations(design).find((o) => o.route === route)
  const soap = soapOp !== undefined ? soapOp.name : null

  // OData is entity-set (model) centric: a route projects onto it only when its
  // success response binds a model that becomes an entity set. The key segment
  // shows when the route carries a path parameter.
  const model = gqlOp?.model ?? grpcOp?.model
  const entitySet = model !== undefined
    ? designODataEntitySets(design).find((s) => s.model === model)
    : undefined
  const odata = entitySet !== undefined
    ? `${method} /odata/${entitySet.name}${routePathParams(route.doc.match.urlPattern).length > 0 ? '({id})' : ''}`
    : null

  return { http: `${method} ${httpPath}`, graphql, grpc, soap, odata }
}

/** Per-protocol operation counts a route group projects onto. */
export interface GroupProjectionSummary {
  /** One HTTP route per group route. */
  http: number
  graphqlQueries: number
  graphqlMutations: number
  grpc: number
  soap: number
  /** Distinct OData entity sets the group's models expose. */
  odataEntitySets: number
}

/**
 * Count how a route group is exposed across every protocol — the multi-protocol
 * surface a CRUD generation (or any group) creates for free. `design` must
 * already contain `group`; the projection functions read the whole design.
 */
export function summarizeGroupProjections(
  design: ApiDesign,
  group: DesignRouteGroup
): GroupProjectionSummary {
  const routeIds = new Set(group.routes.map((r) => r.id))
  const gql = designGraphqlOperations(design).filter((o) => routeIds.has(o.route.id))
  const grpc = designGrpcMethods(design).filter((o) => routeIds.has(o.route.id))
  const soap = designSoapOperations(design).filter((o) => routeIds.has(o.route.id))

  const modelIds = new Set<string>()
  for (const o of gql) if (o.model !== undefined) modelIds.add(o.model.id)
  for (const o of grpc) if (o.model !== undefined) modelIds.add(o.model.id)
  const odataEntitySets = designODataEntitySets(design).filter((s) => modelIds.has(s.model.id)).length

  return {
    http: group.routes.length,
    graphqlQueries: gql.filter((o) => o.kind === 'query').length,
    graphqlMutations: gql.filter((o) => o.kind === 'mutation').length,
    grpc: grpc.length,
    soap: soap.length,
    odataEntitySets
  }
}
