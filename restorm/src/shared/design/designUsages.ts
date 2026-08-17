/**
 * Where a design entity is USED — the readable counterpart of the
 * delete rules. Feeds the model card's "Used by" jump list and the
 * delete-confirmation impact list, from ONE walk so the two can never
 * disagree about what a deletion touches.
 */

import type { ApiDesign, DesignModel } from '../types/apiDesign'

export type DesignModelUsageKind =
  /** A route's request body is shaped by the model. */
  | 'routeBody'
  /** A route response (by status code) returns the model. */
  | 'routeResponse'
  /** A route parameter is linked to one of the model's properties. */
  | 'routeParam'
  /** Another model has a property typed by this model. */
  | 'modelProperty'
  /** Another model inherits from this model. */
  | 'modelInheritance'

export interface DesignModelUsage {
  kind: DesignModelUsageKind
  /** Section the usage lives in — where a jump lands. */
  section: 'models' | 'routes'
  /** Id of the entity to select on jump (route id or model id). */
  entityId: string
  /** Human label, already composed (e.g. `GET /users/{{id}} · réponse 200`
   * composes route + detail); the DETAIL half is localized by the
   * caller via `detailKey` + `detailParams` when needed. */
  label: string
  /** Extra qualifier (status code, property name…). */
  detail?: string
}

/** Every usage of `modelId` across the design, in stable order (routes
 * first, then models). */
export function collectModelUsages(design: ApiDesign, modelId: string): DesignModelUsage[] {
  const usages: DesignModelUsage[] = []

  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      const routeLabel = `${route.doc.match.method ?? ''} ${group.design?.basePath ?? ''}${route.doc.match.urlPattern}`.trim()
      if (route.design?.body?.modelId === modelId) {
        usages.push({ kind: 'routeBody', section: 'routes', entityId: route.id, label: routeLabel })
      }
      for (const [code, response] of Object.entries(route.design?.responses ?? {})) {
        if (response.modelId === modelId) {
          usages.push({ kind: 'routeResponse', section: 'routes', entityId: route.id, label: routeLabel, detail: code })
        }
      }
      for (const [paramName, link] of Object.entries(route.design?.paramLinks ?? {})) {
        if (link.modelId === modelId) {
          usages.push({ kind: 'routeParam', section: 'routes', entityId: route.id, label: routeLabel, detail: paramName })
        }
      }
    }
  }

  for (const model of design.models) {
    if (model.id === modelId) continue
    if (model.design?.inheritsFrom === modelId) {
      usages.push({ kind: 'modelInheritance', section: 'models', entityId: model.id, label: model.doc.name })
    }
    for (const property of model.properties) {
      const reference = property.design?.reference
      if (reference?.target === 'model' && reference.refId === modelId) {
        usages.push({ kind: 'modelProperty', section: 'models', entityId: model.id, label: `${model.doc.name}.${property.doc.name}` })
      }
    }
  }

  return usages
}

/** Models that inherit (directly) from `modelId` — the children a
 * parent-model deletion impacts. */
export function collectInheritanceChildren(design: ApiDesign, modelId: string): DesignModel[] {
  return design.models.filter((m) => m.design?.inheritsFrom === modelId)
}

/**
 * Remove a model from the design, stripping every reference to it: the
 * delete rule the confirmation modal announces. Children lose their
 * inheritance link (their own properties stay), route bodies fall back
 * to empty, response models and param links are dropped, and properties
 * typed by the model degrade to their doc type with the reference
 * cleared. Pure — returns the next `models` and `routeGroups` arrays.
 */
export function removeModelFromDesign(design: ApiDesign, modelId: string): Pick<ApiDesign, 'models' | 'routeGroups'> {
  const models = design.models
    .filter((m) => m.id !== modelId)
    .map((m) => {
      let next = m
      if (next.design?.inheritsFrom === modelId) {
        const { inheritsFrom: _dropped, ...rest } = next.design
        next = { ...next, design: rest }
      }
      const properties = next.properties.map((p) => {
        const reference = p.design?.reference
        if (reference?.target === 'model' && reference.refId === modelId) {
          const { reference: _droppedRef, ...restDesign } = p.design ?? {}
          const { targetModelRef: _droppedName, isArrayOfRef: _droppedArr, ...restDoc } = p.doc
          // Rebuild WITHOUT spreading `p` last: an emptied design bag
          // must disappear, not be shadowed back in by the old one.
          const { design: _oldDesign, ...pRest } = p
          return Object.keys(restDesign).length > 0
            ? { ...pRest, doc: restDoc, design: restDesign }
            : { ...pRest, doc: restDoc }
        }
        return p
      })
      return properties.some((p, i) => p !== next.properties[i]) ? { ...next, properties } : next
    })

  const routeGroups = design.routeGroups.map((group) => ({
    ...group,
    routes: group.routes.map((route) => {
      const meta = route.design
      if (meta === undefined) return route
      let changed = false
      const nextMeta = { ...meta }
      if (nextMeta.body?.modelId === modelId) {
        const { modelId: _dropped, ...bodyRest } = nextMeta.body
        nextMeta.body = bodyRest
        changed = true
      }
      if (nextMeta.responses !== undefined) {
        const responses: NonNullable<typeof nextMeta.responses> = {}
        for (const [code, response] of Object.entries(nextMeta.responses)) {
          if (response.modelId === modelId) {
            const { modelId: _m, exampleId: _e, ...responseRest } = response
            responses[code] = responseRest
            changed = true
          } else {
            responses[code] = response
          }
        }
        nextMeta.responses = responses
      }
      if (nextMeta.paramLinks !== undefined) {
        const paramLinks: NonNullable<typeof nextMeta.paramLinks> = {}
        for (const [name, link] of Object.entries(nextMeta.paramLinks)) {
          if (link.modelId === modelId) {
            changed = true
            continue
          }
          paramLinks[name] = link
        }
        nextMeta.paramLinks = paramLinks
      }
      return changed ? { ...route, design: nextMeta } : route
    })
  }))

  return { models, routeGroups }
}
