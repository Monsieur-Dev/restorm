import { z } from 'zod/v4'

// ==========================================================================
// Theme
// ==========================================================================
export const themeLoadArgs = z.tuple([z.string()])
export const themeSetArgs = z.tuple([z.string()])
export const themeUpdateWcoArgs = z.tuple([
  z.object({ backgroundColor: z.string(), symbolColor: z.string() })
])

// ==========================================================================
// I18n
// ==========================================================================
export const i18nSetLanguageArgs = z.tuple([z.string()])

// ==========================================================================
// Logger
// ==========================================================================
export const loggerLogArgs = z.tuple([
  z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional()
  })
])

// ==========================================================================
// Storage
// ==========================================================================
export const storageGetArgs = z.tuple([z.string()])
export const storageSetArgs = z.tuple([z.string(), z.unknown()])
export const storageDeleteArgs = z.tuple([z.string()])

// ==========================================================================
// Feature
// ==========================================================================
export const featureIsEnabledArgs = z.tuple([z.string()])

// ==========================================================================
// File
// ==========================================================================
export const fileOpenArgs = z.tuple([z.string().optional()])
export const fileSaveArgs = z.tuple([z.unknown()])
export const fileSaveAsArgs = z.tuple([
  z.unknown(),
  z.string().optional(),
  z.enum(['json', 'yaml']).optional()
])
export const fileToggleFavoriteArgs = z.tuple([z.string()])
export const fileRemoveFromRecentArgs = z.tuple([z.string()])
export const fileChecksumArgs = z.tuple([z.string()])
export const fileShowUnsavedDialogArgs = z.tuple([
  z.object({
    title: z.string().optional(),
    message: z.string().optional(),
    detail: z.string().optional(),
    save: z.string().optional(),
    dontSave: z.string().optional(),
    cancel: z.string().optional()
  }).optional()
])
export const fileRegisterChecksumsArgs = z.tuple([
  z.array(z.tuple([z.string(), z.unknown()]))
])
export const fileUpdateObjectChecksumArgs = z.tuple([z.string(), z.unknown()])
export const fileRemoveObjectChecksumArgs = z.tuple([z.string()])

// ==========================================================================
// EventBus
// ==========================================================================
export const eventBusEmitArgs = z.tuple([z.string(), z.unknown()])

// ==========================================================================
// Search
// ==========================================================================
const searchDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  category: z.string(),
  icon: z.string().optional(),
  keywords: z.string().optional(),
  navigation: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

export const searchRegisterCategoriesArgs = z.tuple([
  z.record(z.string(), z.object({
    label: z.string(),
    icon: z.string(),
    order: z.number()
  }))
])
export const searchIndexDocumentArgs = z.tuple([searchDocumentSchema])
export const searchIndexDocumentsArgs = z.tuple([z.array(searchDocumentSchema)])
export const searchRemoveDocumentArgs = z.tuple([z.string()])
export const searchQueryArgs = z.tuple([z.string()])

// ==========================================================================
// Tabs
// ==========================================================================
export const tabsCreateAuxWindowArgs = z.tuple([
  z.object({ editorId: z.string(), title: z.string() }),
  z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional()
  })
])

const tabDataSchema = z.object({
  tabId: z.string(),
  title: z.string(),
  groupId: z.string(),
  content: z.string().optional(),
  cursorX: z.number().optional(),
  cursorY: z.number().optional()
})

export const tabsSendToWindowArgs = z.tuple([z.number(), tabDataSchema])
