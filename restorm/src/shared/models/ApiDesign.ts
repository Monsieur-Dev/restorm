/**
 * ApiDesign - an API designed in Restorm (models, enums, routes) from
 * which specs, servers, database schemas and code are derived.
 *
 * A tree item placeable at the document root or inside an env-folder.
 * A LEAF in tree terms: its models/enums/routes are sections of the
 * Design tab, never tree children. See `shared/types/apiDesign.ts` for
 * the full entity contract.
 */

import {
  trackable,
  searchable,
  fileNaming,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import type { RuntimeId } from './types'
import type { ApiInfo, ApiServer, SecurityScheme } from '../types/apiDocumentation'
import type {
  DesignModel,
  DesignEnum,
  DesignRouteGroup,
  DesignServing,
  DesignCodegen,
  DesignCodegenTemplate,
  DesignAuthKind
} from '../types/apiDesign'
import { generateUniqueId } from '../utils/reidentifyTree'

/**
 * Normalize a persisted `codegen` slot into the current LIST shape
 * (TASK-468.20). A pre-468.20 file carried a single `templateSource` (+ a
 * single `outputDir`); we migrate it into a one-entry `templates` list and
 * never re-emit the legacy fields. A file already in list shape is returned
 * untouched. Returns `undefined` for an empty slot so we never persist `{}`.
 */
function normalizeCodegen(codegen: DesignCodegen): DesignCodegen | undefined {
  if (codegen.templates !== undefined) {
    return codegen.templates.length > 0 ? { templates: codegen.templates } : undefined
  }
  if (codegen.templateSource !== undefined) {
    const entry: DesignCodegenTemplate = {
      id: generateUniqueId(),
      source: codegen.templateSource,
      ...(codegen.outputDir !== undefined && { outputDir: codegen.outputDir })
    }
    return { templates: [entry] }
  }
  return undefined
}

@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class ApiDesign {
  /** Discriminates a design from a request inside `FolderItem`. */
  readonly type = 'design' as const

  /** Stable identifier persisted with the document. See `Folder.id`. */
  id!: RuntimeId

  /** Sidebar / tab label. Distinct from `info.title`, the API's
   * published title. */
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional user notes (the Notes section). */
  @searchable.property({ weight: 0.5 })
  @TreatEmptyAsUndefined()
  notes?: string

  /** The API's published identity (title, version, contact, license). */
  info: ApiInfo = { title: '' }

  /** Published connection info (host, base path, schemes). */
  server?: ApiServer

  /** Named security schemes. */
  securitySchemes?: Record<string, SecurityScheme>

  /** Spec-level security requirement. */
  defaultSecurity?: Record<string, string[]>[]

  /** Default auth contract routes fall back to. */
  defaultAuth?: DesignAuthKind

  /** Design-server configuration. */
  serving?: DesignServing

  /** Code-generation configuration (template source, output folder). */
  codegen?: DesignCodegen

  /** The design's models, in author order. */
  models: DesignModel[] = []

  /** The design's enums, in author order. */
  enums: DesignEnum[] = []

  /** The design's route groups, in author order. */
  routeGroups: DesignRouteGroup[] = []

  constructor(init?: Partial<ApiDesign>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    notes?: string
    info?: ApiInfo
    server?: ApiServer
    securitySchemes?: Record<string, SecurityScheme>
    defaultSecurity?: Record<string, string[]>[]
    defaultAuth?: DesignAuthKind
    serving?: DesignServing
    codegen?: DesignCodegen
    models?: DesignModel[]
    enums?: DesignEnum[]
    routeGroups?: DesignRouteGroup[]
  }): ApiDesign {
    const codegen = obj.codegen !== undefined ? normalizeCodegen(obj.codegen) : undefined
    return new ApiDesign({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      info: obj.info ?? { title: '' },
      ...(obj.server !== undefined && { server: obj.server }),
      ...(obj.securitySchemes !== undefined && { securitySchemes: obj.securitySchemes }),
      ...(obj.defaultSecurity !== undefined && { defaultSecurity: obj.defaultSecurity }),
      ...(obj.defaultAuth !== undefined && { defaultAuth: obj.defaultAuth }),
      ...(obj.serving !== undefined && { serving: obj.serving }),
      ...(codegen !== undefined && { codegen }),
      models: obj.models ?? [],
      enums: obj.enums ?? [],
      routeGroups: obj.routeGroups ?? []
    })
  }

  toPlainObject(): Record<string, unknown> {
    return {
      type: this.type,
      id: this.id,
      name: this.name,
      notes: this.notes,
      info: this.info,
      ...(this.server !== undefined && { server: this.server }),
      ...(this.securitySchemes !== undefined && { securitySchemes: this.securitySchemes }),
      ...(this.defaultSecurity !== undefined && { defaultSecurity: this.defaultSecurity }),
      ...(this.defaultAuth !== undefined && { defaultAuth: this.defaultAuth }),
      ...(this.serving !== undefined && { serving: this.serving }),
      ...(this.codegen !== undefined && { codegen: this.codegen }),
      models: this.models,
      enums: this.enums,
      routeGroups: this.routeGroups
    }
  }
}
