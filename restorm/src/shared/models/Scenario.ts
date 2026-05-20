/**
 * Scenario - a dataflow graph of orchestrated requests.
 *
 * A tree item placeable anywhere (never bound to an env-folder). In
 * folder mode it persists as its own file alongside requests, named via
 * `@fileNaming` like the request models.
 */

import {
  trackable,
  searchable,
  fileNaming,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import type { RuntimeId } from './types'
import type { ScenarioNode, ScenarioEdge, ScenarioParam } from '../types/scenario'

@trackable()
@searchable()
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class Scenario {
  /** Discriminates a scenario from a request inside `FolderItem`. */
  readonly type = 'scenario' as const

  /** Stable identifier persisted with the document. See `Folder.id`. */
  id!: RuntimeId

  /** Display name of the scenario. */
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional user notes. */
  @searchable.property({ weight: 0.5 })
  @TreatEmptyAsUndefined()
  notes?: string

  /** Tags for categorization and filtering. */
  @searchable.property({ weight: 1.5, filterable: true })
  tags: string[] = []

  /** Named input parameters injected into the graph by Input nodes. */
  params: ScenarioParam[] = []

  /** Nodes (boxes) on the scenario surface. */
  nodes: ScenarioNode[] = []

  /** Directed port→port links carrying data between nodes. */
  edges: ScenarioEdge[] = []

  constructor(init?: Partial<Scenario>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    notes?: string
    tags?: string[]
    params?: ScenarioParam[]
    nodes?: ScenarioNode[]
    edges?: ScenarioEdge[]
  }): Scenario {
    return new Scenario({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      params: obj.params ?? [],
      nodes: obj.nodes ?? [],
      edges: obj.edges ?? []
    })
  }

  toPlainObject(): Record<string, unknown> {
    return {
      type: this.type,
      id: this.id,
      name: this.name,
      notes: this.notes,
      tags: this.tags,
      params: this.params,
      nodes: this.nodes,
      edges: this.edges
    }
  }
}
