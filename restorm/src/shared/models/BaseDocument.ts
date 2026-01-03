/**
 * Base Document - Abstract base class for all Restorm documents
 *
 * Provides common properties and decorator configuration that all documents share.
 */

import {
  trackable,
  searchable,
  NonSerialised
} from 'electron-core-ui/main'
import type { RuntimeId, Icon } from './types'

/**
 * Abstract base class for all Restorm documents.
 * Provides runtime ID (non-serialized) and common properties.
 */
@trackable()
@searchable()
export abstract class BaseDocument {
  /** Runtime identifier (generated at runtime, not persisted) */
  @NonSerialised()
  id!: RuntimeId

  /** Display name of the document */
  @searchable.property({ weight: 2 })
  name!: string

  /** Optional icon for the document */
  icon?: Icon

  /** Documentation describing the document purpose and usage */
  @searchable.property({ weight: 1 })
  documentation = ''

  /** Optional user notes */
  @searchable.property({ weight: 0.5 })
  notes?: string

  /** Tags for categorization and filtering */
  @searchable.property({ weight: 1.5, filterable: true })
  tags: string[] = []

  constructor(init?: Partial<BaseDocument>) {
    if (init) {
      Object.assign(this, init)
    }
  }

  /**
   * Create a plain object from this document (for serialization)
   */
  toPlainObject(): Record<string, unknown> {
    return {
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags
    }
  }
}
