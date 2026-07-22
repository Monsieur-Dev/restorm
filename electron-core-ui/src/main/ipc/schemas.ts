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
// Window controls (fire-and-forget ipcMain.on payloads)
// ==========================================================================
export const setWindowTitleArgs = z.tuple([z.string()])
export const registerInterceptedShortcutsArgs = z.tuple([z.array(z.string())])

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
export const fileSaveArgs = z.tuple([z.unknown(), z.object({ force: z.boolean().optional() }).optional()])
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
// Save unit v2 API
const saveUnitKindSchema = z.enum(['file', 'folder'])
const saveUnitReasonSchema = z.enum(['modify', 'create', 'delete', 'rename', 'move', 'reorder']).optional()
export const fileHydrateSaveUnitArgs = z.tuple([
  z.object({
    runtimeId: z.string(),
    kind: saveUnitKindSchema,
    reference: z.unknown(),
    parentId: z.string().optional()
  })
])
export const fileUpsertSaveUnitArgs = z.tuple([
  z.object({
    runtimeId: z.string(),
    kind: saveUnitKindSchema,
    draft: z.unknown(),
    reason: saveUnitReasonSchema,
    parentId: z.string().optional()
  })
])
export const fileSaveUnitIdArgs = z.tuple([z.string()])
const persistenceFormatSchema = z.enum(['json', 'json5', 'yaml'])
const saveUnitEntrySchema = z.object({
  runtimeId: z.string(),
  content: z.unknown(),
  absolutePath: z.string(),
  format: persistenceFormatSchema
})
export const fileSaveUnitToDiskArgs = z.tuple([saveUnitEntrySchema])
export const fileSaveUnitsBatchArgs = z.tuple([z.array(saveUnitEntrySchema)])

// ==========================================================================
// EventBus
// ==========================================================================
export const eventBusEmitArgs = z.tuple([z.string(), z.unknown()])

// ==========================================================================
// Search
// ==========================================================================
// Shape mirrors `SearchDocument` (see SearchService) — the single source of
// truth for the search-document shape over IPC.
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

// ==========================================================================
// Settings
// ==========================================================================
export const settingsGetArgs = z.tuple([z.string()])
export const settingsSetArgs = z.tuple([z.string(), z.union([z.string(), z.number(), z.boolean()])])
export const settingsSearchArgs = z.tuple([z.string()])
export const settingsResetArgs = z.tuple([z.string()])

// ==========================================================================
// Git
// ==========================================================================
export const gitFolderArgs = z.tuple([z.string()])
export const gitSetActiveFolderArgs = z.tuple([z.string().nullable()])
export const gitStageArgs = z.tuple([z.string(), z.array(z.string())])
export const gitCommitArgs = z.tuple([z.string(), z.string(), z.array(z.string()).optional()])
export const gitConflictVersionsArgs = z.tuple([z.string(), z.string()])
export const gitWriteResolvedConflictArgs = z.tuple([z.string(), z.string(), z.string()])
