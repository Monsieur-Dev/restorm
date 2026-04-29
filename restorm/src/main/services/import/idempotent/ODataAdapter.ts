import type {
  AdapterOptions,
  GenericOperationShape,
  ImportAdapter,
  NormalizedEnum,
  NormalizedModel,
  NormalizedOperation,
  NormalizedSpec
} from './types'

/**
 * OData CSDL declares EntitySets, Functions, and Actions. The
 * pipeline normalises one operation per EntitySet (representing the
 * collection-level CRUD endpoint) and one per Function / Action.
 * Models come from the EntityType / ComplexType definitions; enums
 * come from EnumType.
 *
 * `naturalKey` is `${kind} ${name}`:
 * - `entitySet Pets`
 * - `function GetPetByName`
 * - `action AddPet`
 *
 * This kind-prefix prevents accidental matches when an EntitySet
 * shares its name with an Action — uncommon but possible.
 */
interface ODataPropertyLike {
  name: string
  type?: string
  nullable?: boolean
  description?: string
  deprecated?: boolean
}

interface ODataEntityTypeLike {
  name: string
  properties?: ODataPropertyLike[]
  deprecated?: boolean
  description?: string
}

interface ODataEnumLike {
  name: string
  members?: { name: string }[]
  deprecated?: boolean
}

interface ODataEntitySetLike {
  name: string
  entityType?: string
  deprecated?: boolean
}

interface ODataOperationLike {
  name: string
  kind: 'function' | 'action'
  parameters?: { name: string; type?: string }[]
  returnType?: string
  deprecated?: boolean
}

interface ODataSpecLike {
  version?: string
  entityTypes?: ODataEntityTypeLike[]
  enumTypes?: ODataEnumLike[]
  entitySets?: ODataEntitySetLike[]
  operations?: ODataOperationLike[]
}

export const odataImportAdapter: ImportAdapter = {
  format: 'odata',
  extractNormalizedSpec(rawSpec: unknown, _options: AdapterOptions): NormalizedSpec {
    const spec = rawSpec as ODataSpecLike
    const operations: NormalizedOperation[] = []
    for (const set of spec.entitySets ?? []) {
      operations.push({
        naturalKey: `entitySet ${set.name}`,
        name: set.name,
        deprecated: set.deprecated === true,
        shape: {
          protocol: 'odata',
          raw: { kind: 'entitySet', name: set.name, ...(set.entityType !== undefined ? { entityType: set.entityType } : {}) }
        } satisfies GenericOperationShape
      })
    }
    for (const op of spec.operations ?? []) {
      operations.push({
        naturalKey: `${op.kind} ${op.name}`,
        name: op.name,
        deprecated: op.deprecated === true,
        shape: {
          protocol: 'odata',
          raw: {
            kind: op.kind,
            name: op.name,
            parameters: op.parameters ?? [],
            ...(op.returnType !== undefined ? { returnType: op.returnType } : {})
          }
        } satisfies GenericOperationShape
      })
    }
    const models: NormalizedModel[] = (spec.entityTypes ?? []).map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      deprecated: t.deprecated === true,
      properties: (t.properties ?? []).map((p) => ({
        name: p.name,
        type: p.type ?? 'unknown',
        required: p.nullable === false,
        ...(p.description !== undefined ? { description: p.description } : {}),
        deprecated: p.deprecated === true
      }))
    }))
    const enums: NormalizedEnum[] = (spec.enumTypes ?? []).map((e) => ({
      name: e.name,
      values: (e.members ?? []).map((m) => m.name),
      deprecated: e.deprecated === true
    }))
    return {
      ...(spec.version !== undefined ? { version: spec.version } : {}),
      operations,
      models,
      enums,
      environments: []
    }
  }
}
