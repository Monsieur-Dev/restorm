// Lightweight runtime shim to make electron-core-ui usable in pure web builds
// (without Electron preload defining window.api). In a real Electron renderer,
// the preload script will have already populated window.api, so this shim is
// effectively a no-op.

import type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../types/theme'
import type { FeaturePlatform } from '../types/feature'
import type { FileServiceState, FileMetadata } from '../types/file'
import type { CoreUiApi, CoreUiThemeApi, CoreUiStorageApi, CoreUiFeatureApi, CoreUiFileApi, CoreUiEventBusApi, CoreUiI18nApi, CoreUiSearchApi, CoreUiSearchDocument, CoreUiSearchResult, CoreUiSearchResultGroup } from '../types/api'
import yaml from 'js-yaml'
import themeIndexJson from '../../resources/themes/index.json'

// Dynamically import all theme YAML files using Vite's glob import
const themeYamlModules = import.meta.glob<string>('../../resources/themes/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true
})

// Helper to extract theme ID from file path
function getThemeIdFromPath(path: string): string {
  // Path format: ../../resources/themes/dark/abyss.yaml -> dark/abyss
  const match = /themes\/(.+)\.yaml$/.exec(path)
  return match?.[1] ?? ''
}

// Build mappings from glob imports
const baseYaml = themeYamlModules['../../resources/themes/base.yaml'] ?? ''
const darkBaseYaml = themeYamlModules['../../resources/themes/dark/_base.yaml'] ?? ''
const lightBaseYaml = themeYamlModules['../../resources/themes/light/_base.yaml'] ?? ''
const hcDarkBaseYaml = themeYamlModules['../../resources/themes/hc_dark/_base.yaml'] ?? ''
const hcLightBaseYaml = themeYamlModules['../../resources/themes/hc_light/_base.yaml'] ?? ''

type ThemeTypeInternal = 'dark' | 'light' | 'hc_dark' | 'hc_light'

interface ThemeIndexEntry {
  id: string
  name: string
  type: ThemeTypeInternal
  description?: string
  file: string
}

interface ThemeIndex {
  themes: ThemeIndexEntry[]
}

interface YamlColorEntry {
  id: string
  value: string
}

interface YamlVariableEntry {
  id: string
  value: string
}

interface YamlBaseFile {
  variables?: YamlVariableEntry[]
}

interface YamlTypeBaseFile {
  colors?: YamlColorEntry[]
}

interface YamlThemeFile {
  name: string
  description?: string
  colors?: Record<string, string>
}

interface ThemeCacheValue { theme: ThemeDefinition; variables: ThemeVariables }

const themeIndex = themeIndexJson as ThemeIndex

// Build theme YAML mapping dynamically from glob imports
const THEME_YAML_BY_ID: Record<string, string> = {}
for (const [path, content] of Object.entries(themeYamlModules)) {
  const themeId = getThemeIdFromPath(path)
  // Skip base files and root base.yaml
  if (themeId && !themeId.endsWith('/_base') && themeId !== 'base') {
    THEME_YAML_BY_ID[themeId] = content
  }
}

let webBaseVariables: ThemeVariables | null = null
const webTypeBaseColors: Record<ThemeTypeInternal, Record<string, string>> = {
  dark: {},
  light: {},
  hc_dark: {},
  hc_light: {}
}
const webThemeCache = new Map<string, ThemeCacheValue>()

function mapThemeTypeInternalToInfo(type: ThemeTypeInternal): ThemeInfo['type'] {
  switch (type) {
    case 'dark':
      return 'dark'
    case 'light':
      return 'light'
    case 'hc_dark':
      return 'hcDark'
    case 'hc_light':
      return 'hcLight'
    default:
      return 'dark'
  }
}

function ensureWebBaseLoaded(): void {
  if (webBaseVariables) return

  webBaseVariables = {}

  // base.yaml
  try {
    const parsed = yaml.load(baseYaml) as YamlBaseFile
    if (parsed.variables) {
      for (const v of parsed.variables) {
        const cssVar = `--${v.id}`
        webBaseVariables[cssVar] = v.value
      }
    }
  } catch {
    // ignore in web
  }

  const typeBaseSources: Record<ThemeTypeInternal, string> = {
    dark: darkBaseYaml,
    light: lightBaseYaml,
    hc_dark: hcDarkBaseYaml,
    hc_light: hcLightBaseYaml
  }

  for (const type of Object.keys(typeBaseSources) as ThemeTypeInternal[]) {
    try {
      const parsed = yaml.load(typeBaseSources[type]) as YamlTypeBaseFile
      if (parsed.colors) {
        for (const c of parsed.colors) {
          const cssVar = `--${c.id.replace(/\./g, '-')}`
          webTypeBaseColors[type][cssVar] = c.value
        }
      }
    } catch {
      // ignore in web
    }
  }
}

function webListThemes(): ThemeInfo[] {
  ensureWebBaseLoaded()
  return themeIndex.themes.map((entry) => ({
    id: entry.id,
    name: entry.name,
    type: mapThemeTypeInternalToInfo(entry.type),
    path: entry.file
  }))
}

function webLoadTheme(themeId: string): ThemeCacheValue | null {
  ensureWebBaseLoaded()

  const cached = webThemeCache.get(themeId)
  if (cached) return cached

  const entry = themeIndex.themes.find((t) => t.id === themeId)
  if (!entry) return null

  const yamlSource = THEME_YAML_BY_ID[entry.id]
  if (!yamlSource) return null

  let parsed: YamlThemeFile
  try {
    parsed = yaml.load(yamlSource) as YamlThemeFile
  } catch {
    return null
  }

  const variables: ThemeVariables = {
    ...(webBaseVariables ?? {}),
    ...webTypeBaseColors[entry.type]
  }

  const colors: Record<string, string> = {}

  for (const [cssVar, val] of Object.entries(webTypeBaseColors[entry.type])) {
    if (cssVar.startsWith('--')) {
      const key = cssVar.slice(9).replace(/-/g, '.')
      colors[key] = val
    }
  }

  if (parsed.colors) {
    for (const [key, value] of Object.entries(parsed.colors)) {
      const cssVar = `--${key.replace(/\./g, '-')}`
      variables[cssVar] = value
      colors[key] = value
    }
  }

  const theme: ThemeDefinition = {
    name: parsed.name,
    type: mapThemeTypeInternalToInfo(entry.type),
    colors
  }

  const value: ThemeCacheValue = { theme, variables }
  webThemeCache.set(themeId, value)
  return value
}

export function ensureCoreUiWebApiShim(): void {
  if (typeof window === 'undefined') {
    return
  }

  const w: Record<string, unknown> = window as unknown as Record<string, unknown>

  // If preload already injected a real API (Electron), do nothing.
  if ('api' in w && w['api']) {
    return
  }

  const themeApi: CoreUiThemeApi = {
    list: () => Promise.resolve(webListThemes()),
    load: (themeId: string) => Promise.resolve(webLoadTheme(themeId)),
    getCurrent: () => {
      // Default to first dark theme if available
      const themes: ThemeInfo[] = webListThemes()
      const darkTheme: ThemeInfo | undefined = themes.find((t) => t.type === 'dark')
      const firstTheme: ThemeInfo | undefined = themes[0]
      const selectedTheme = darkTheme ?? firstTheme
      return Promise.resolve(selectedTheme?.id)
    },
    set: () => Promise.resolve(true),
    updateWCO: () => Promise.resolve(true),
    onThemeChanged: (_callback: (themeId: string) => void) => () => {
      // no-op in web shim
    }
  }

  // I18n shim for web builds (no-op, language is handled by i18next directly)
  let webCurrentLanguage = 'en'
  const i18nApi: CoreUiI18nApi = {
    setLanguage: (language: string): Promise<boolean> => {
      webCurrentLanguage = language
      return Promise.resolve(true)
    },
    getLanguage: (): Promise<string> => {
      return Promise.resolve(webCurrentLanguage)
    }
  }

  // Storage shim using localStorage for web builds
  const storageApi: CoreUiStorageApi = {
    get: (key: string): Promise<unknown> => {
      try {
        const item = localStorage.getItem(`ecui_${key}`)
        return Promise.resolve(item ? JSON.parse(item) as unknown : undefined)
      } catch {
        return Promise.resolve(undefined)
      }
    },
    set: (key: string, value: unknown): Promise<boolean> => {
      try {
        localStorage.setItem(`ecui_${key}`, JSON.stringify(value))
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    },
    delete: (key: string): Promise<boolean> => {
      try {
        localStorage.removeItem(`ecui_${key}`)
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    }
  }

  // Feature API shim for web builds
  // In web builds, features always return false (platform is 'web')
  const featureApi: CoreUiFeatureApi = {
    isEnabled: (_featureName: string): Promise<boolean> => {
      // In web platform, features are disabled by default unless configured otherwise
      return Promise.resolve(false)
    },
    getPlatform: (): Promise<FeaturePlatform> => {
      return Promise.resolve('web')
    }
  }

  // File API shim for web builds
  // Uses localStorage for file storage
  const WEB_FILE_PREFIX = 'webfile_'
  const WEB_RECENT_KEY = 'webfile_recent'
  const WEB_FAVORITES_KEY = 'webfile_favorites'

  let webCurrentFile: { path: string | null; name: string | null; isDirty: boolean; content: unknown; contentChecksum: string | null } = {
    path: null,
    name: null,
    isDirty: false,
    content: null,
    contentChecksum: null
  }

  const webStateChangeCallbacks = new Set<(state: FileServiceState) => void>()
  const webDirtyChangeCallbacks = new Set<(isDirty: boolean) => void>()
  const webFileOpenedCallbacks = new Set<(state: FileServiceState) => void>()
  const webFileClosedCallbacks = new Set<() => void>()
  
  // Expose test helper to trigger file opened event (for E2E tests)
  if (typeof window !== 'undefined') {
    (window as unknown as { __webFileTestHelpers?: { triggerFileOpened: (state: FileServiceState) => void } }).__webFileTestHelpers = {
      triggerFileOpened: (state: FileServiceState) => {
        for (const cb of webFileOpenedCallbacks) {
          try { cb(state) } catch { /* ignore */ }
        }
      }
    }
  }

  const getWebState = (): FileServiceState => {
    const recentJson = localStorage.getItem(WEB_RECENT_KEY)
    const favoritesJson = localStorage.getItem(WEB_FAVORITES_KEY)
    const recent: FileMetadata[] = recentJson ? JSON.parse(recentJson) as FileMetadata[] : []
    const favorites = favoritesJson ? JSON.parse(favoritesJson) as string[] : []

    return {
      currentFile: {
        path: webCurrentFile.path,
        name: webCurrentFile.name,
        isDirty: webCurrentFile.isDirty,
        content: webCurrentFile.content,
        format: 'json',
        contentChecksum: webCurrentFile.contentChecksum
      },
      recentFiles: recent,
      favorites: recent.filter(f => favorites.includes(f.path)),
      platform: 'web'
    }
  }

  const notifyWebStateChange = (): void => {
    const state = getWebState()
    for (const cb of webStateChangeCallbacks) {
      try { cb(state) } catch { /* ignore */ }
    }
  }

  const notifyWebDirtyChange = (): void => {
    for (const cb of webDirtyChangeCallbacks) {
      try { cb(webCurrentFile.isDirty) } catch { /* ignore */ }
    }
  }

  const notifyWebFileOpened = (): void => {
    const state = getWebState()
    for (const cb of webFileOpenedCallbacks) {
      try { cb(state) } catch { /* ignore */ }
    }
  }

  const notifyWebFileClosed = (): void => {
    for (const cb of webFileClosedCallbacks) {
      try { cb() } catch { /* ignore */ }
    }
  }

  const fileApi: CoreUiFileApi = {
    newFile: (): Promise<boolean> => {
      // Web behavior: For web, we'll ask for a name via prompt
      const name = window.prompt('Enter file name:')
      if (!name) {
        return Promise.resolve(false)
      }
      const emptyContent = {}
      webCurrentFile = { path: name, name, isDirty: false, content: emptyContent, contentChecksum: JSON.stringify(emptyContent) }
      // Save empty content to localStorage
      localStorage.setItem(WEB_FILE_PREFIX + name, JSON.stringify(emptyContent))
      notifyWebStateChange()
      notifyWebDirtyChange()
      notifyWebFileOpened()
      return Promise.resolve(true)
    },
    open: (path?: string): Promise<{ success: boolean; content?: unknown }> => {
      if (!path) {
        // For web, we need the app to handle showing a file picker
        return Promise.resolve({ success: false })
      }
      try {
        const data = localStorage.getItem(WEB_FILE_PREFIX + path)
        if (!data) return Promise.resolve({ success: false })
        const content = JSON.parse(data) as unknown
        webCurrentFile = { path, name: path, isDirty: false, content, contentChecksum: JSON.stringify(content) }
        notifyWebStateChange()
        notifyWebDirtyChange()
        notifyWebFileOpened()
        return Promise.resolve({ success: true, content })
      } catch {
        return Promise.resolve({ success: false })
      }
    },
    save: (content: unknown): Promise<boolean> => {
      if (!webCurrentFile.path) return Promise.resolve(false)
      try {
        localStorage.setItem(WEB_FILE_PREFIX + webCurrentFile.path, JSON.stringify(content))
        webCurrentFile.content = content
        webCurrentFile.isDirty = false
        webCurrentFile.contentChecksum = JSON.stringify(content)
        notifyWebStateChange()
        notifyWebDirtyChange()
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    },
    saveAs: (content: unknown, filename?: string): Promise<boolean> => {
      const name = filename ?? `file_${String(Date.now())}`
      try {
        localStorage.setItem(WEB_FILE_PREFIX + name, JSON.stringify(content))
        webCurrentFile = { path: name, name, isDirty: false, content, contentChecksum: JSON.stringify(content) }
        // Add to recent
        const recentJson = localStorage.getItem(WEB_RECENT_KEY)
        const recent: FileMetadata[] = recentJson ? JSON.parse(recentJson) as FileMetadata[] : []
        const filtered = recent.filter(f => f.path !== name)
        filtered.unshift({ path: name, name, lastOpened: Date.now(), isFavorite: false })
        localStorage.setItem(WEB_RECENT_KEY, JSON.stringify(filtered.slice(0, 10)))
        notifyWebStateChange()
        notifyWebDirtyChange()
        return Promise.resolve(true)
      } catch {
        return Promise.resolve(false)
      }
    },
    close: (): Promise<boolean> => {
      webCurrentFile = { path: null, name: null, isDirty: false, content: null, contentChecksum: null }
      notifyWebStateChange()
      notifyWebDirtyChange()
      notifyWebFileClosed()
      return Promise.resolve(true)
    },
    getState: (): Promise<FileServiceState | null> => Promise.resolve(getWebState()),
    getFileName: (): Promise<string | null> => Promise.resolve(webCurrentFile.name),
    getFilePath: (): Promise<string | null> => Promise.resolve(webCurrentFile.path),
    isDirty: (): Promise<boolean> => Promise.resolve(webCurrentFile.isDirty),
    markDirty: (): Promise<void> => {
      if (!webCurrentFile.isDirty) {
        webCurrentFile.isDirty = true
        notifyWebStateChange()
        notifyWebDirtyChange()
      }
      return Promise.resolve()
    },
    clearDirty: (): Promise<void> => {
      if (webCurrentFile.isDirty) {
        webCurrentFile.isDirty = false
        notifyWebStateChange()
        notifyWebDirtyChange()
      }
      return Promise.resolve()
    },
    checkAndUpdateDirty: (currentChecksum: string): Promise<void> => {
      const hasChanges = webCurrentFile.contentChecksum !== null && webCurrentFile.contentChecksum !== currentChecksum
      if (hasChanges && !webCurrentFile.isDirty) {
        webCurrentFile.isDirty = true
        notifyWebStateChange()
        notifyWebDirtyChange()
      } else if (!hasChanges && webCurrentFile.isDirty) {
        webCurrentFile.isDirty = false
        notifyWebStateChange()
        notifyWebDirtyChange()
      }
      return Promise.resolve()
    },
    finishLoading: (): Promise<void> => {
      // No-op for web builds
      return Promise.resolve()
    },
    showUnsavedChangesDialog: (labels?: {
      title?: string
      message?: string
      detail?: string
      save?: string
      dontSave?: string
      cancel?: string
    }): Promise<'save' | 'discard' | 'cancel'> => {
      // Simple web implementation using confirm
      const message = labels?.message ?? 'You have unsaved changes. Do you want to save them?'
      const result = window.confirm(message)
      return Promise.resolve(result ? 'save' : 'discard')
    },
    getRecentFiles: (): Promise<FileMetadata[]> => {
      const recentJson = localStorage.getItem(WEB_RECENT_KEY)
      return Promise.resolve(recentJson ? JSON.parse(recentJson) as FileMetadata[] : [])
    },
    getFavorites: (): Promise<FileMetadata[]> => {
      const recentJson = localStorage.getItem(WEB_RECENT_KEY)
      const favoritesJson = localStorage.getItem(WEB_FAVORITES_KEY)
      const recent: FileMetadata[] = recentJson ? JSON.parse(recentJson) as FileMetadata[] : []
      const favorites = favoritesJson ? JSON.parse(favoritesJson) as string[] : []
      return Promise.resolve(recent.filter(f => favorites.includes(f.path)))
    },
    toggleFavorite: (path: string): Promise<boolean> => {
      const favoritesJson = localStorage.getItem(WEB_FAVORITES_KEY)
      const favorites = favoritesJson ? JSON.parse(favoritesJson) as string[] : []
      const idx = favorites.indexOf(path)
      if (idx >= 0) {
        favorites.splice(idx, 1)
      } else {
        favorites.push(path)
      }
      localStorage.setItem(WEB_FAVORITES_KEY, JSON.stringify(favorites))
      notifyWebStateChange()
      return Promise.resolve(idx < 0)
    },
    removeFromRecent: (path: string): Promise<void> => {
      const recentJson = localStorage.getItem(WEB_RECENT_KEY)
      const recent: FileMetadata[] = recentJson ? JSON.parse(recentJson) as FileMetadata[] : []
      const filtered = recent.filter(f => f.path !== path)
      localStorage.setItem(WEB_RECENT_KEY, JSON.stringify(filtered))
      notifyWebStateChange()
      return Promise.resolve()
    },
    getContentChecksum: (): Promise<string | null> => {
      return Promise.resolve(webCurrentFile.contentChecksum)
    },
    setContentChecksum: (checksum: string): Promise<void> => {
      webCurrentFile.contentChecksum = checksum
      return Promise.resolve()
    },
    hasContentChanged: (currentChecksum: string): Promise<boolean> => {
      if (webCurrentFile.contentChecksum === null) {
        return Promise.resolve(false)
      }
      return Promise.resolve(webCurrentFile.contentChecksum !== currentChecksum)
    },
    // Object checksum tracking (simplified for web - uses in-memory maps)
    registerInitialChecksums: (_objects: Map<string, unknown>): Promise<void> => {
      // Web shim: no-op, dirty state handled by content checksum
      return Promise.resolve()
    },
    updateObjectChecksum: (_runtimeId: string, _data: unknown): Promise<void> => {
      // Web shim: no-op
      return Promise.resolve()
    },
    removeObjectChecksum: (_runtimeId: string): Promise<void> => {
      // Web shim: no-op
      return Promise.resolve()
    },
    commitChecksums: (): Promise<void> => {
      // Web shim: no-op
      return Promise.resolve()
    },
    getDirtyStateDetails: (): Promise<{
      isDirty: boolean
      changedIds: string[]
      newIds: string[]
      deletedIds: string[]
    }> => {
      return Promise.resolve({
        isDirty: webCurrentFile.isDirty,
        changedIds: [],
        newIds: [],
        deletedIds: []
      })
    },
    onStateChanged: (callback: (state: FileServiceState) => void): (() => void) => {
      webStateChangeCallbacks.add(callback)
      return () => { webStateChangeCallbacks.delete(callback) }
    },
    onDirtyChanged: (callback: (isDirty: boolean) => void): (() => void) => {
      webDirtyChangeCallbacks.add(callback)
      return () => { webDirtyChangeCallbacks.delete(callback) }
    },
    onFileOpened: (callback: (state: FileServiceState) => void): (() => void) => {
      webFileOpenedCallbacks.add(callback)
      return () => { webFileOpenedCallbacks.delete(callback) }
    },
    onFileClosed: (callback: () => void): (() => void) => {
      webFileClosedCallbacks.add(callback)
      return () => { webFileClosedCallbacks.delete(callback) }
    }
  }

  // EventBus shim for web builds (in-memory, same process)
  const webEventHandlers = new Map<string, Set<(payload: unknown) => void>>()
  const eventBusApi: CoreUiEventBusApi = {
    emit: (event: string, payload: unknown): Promise<boolean> => {
      const handlers = webEventHandlers.get(event)
      if (handlers) {
        for (const handler of handlers) {
          try { handler(payload) } catch { /* ignore */ }
        }
      }
      return Promise.resolve(true)
    },
    emitSync: (event: string, payload: unknown): Promise<boolean> => {
      setTimeout(() => {
        const handlers = webEventHandlers.get(event)
        if (handlers) {
          for (const handler of handlers) {
            try { handler(payload) } catch { /* ignore */ }
          }
        }
      }, 0)
      return Promise.resolve(true)
    }
  }

  // Search shim for web builds (in-memory index)
  const webSearchDocuments = new Map<string, CoreUiSearchDocument>()
  const webSearchCategories: Record<string, { label: string; icon: string; order: number }> = {}

  const searchApi: CoreUiSearchApi = {
    registerCategories: (categories): Promise<boolean> => {
      Object.assign(webSearchCategories, categories)
      return Promise.resolve(true)
    },
    indexDocument: (doc): Promise<boolean> => {
      webSearchDocuments.set(doc.id, doc)
      return Promise.resolve(true)
    },
    indexDocuments: (docs): Promise<boolean> => {
      for (const doc of docs) {
        webSearchDocuments.set(doc.id, doc)
      }
      return Promise.resolve(true)
    },
    removeDocument: (id): Promise<boolean> => {
      webSearchDocuments.delete(id)
      return Promise.resolve(true)
    },
    clearIndex: (): Promise<boolean> => {
      webSearchDocuments.clear()
      return Promise.resolve(true)
    },
    search: (query): Promise<CoreUiSearchResultGroup[]> => {
      // Simple case-insensitive substring search for web builds
      const lowerQuery = query.toLowerCase()
      const results: CoreUiSearchResult[] = []

      for (const doc of webSearchDocuments.values()) {
        const titleMatch = doc.title.toLowerCase().includes(lowerQuery)
        const descMatch = doc.description?.toLowerCase().includes(lowerQuery)
        const keywordsMatch = doc.keywords?.toLowerCase().includes(lowerQuery)
        if (titleMatch || descMatch || keywordsMatch) {
          results.push({ ...doc, score: titleMatch ? 2 : 1 })
        }
      }

      // Group by category
      const grouped = new Map<string, typeof results>()
      for (const result of results) {
        const cat = result.category
        if (!grouped.has(cat)) grouped.set(cat, [])
        grouped.get(cat)?.push(result)
      }

      const output: CoreUiSearchResultGroup[] = []

      for (const [category, items] of grouped) {
        const meta = webSearchCategories[category] ?? { label: category, icon: 'symbol-misc', order: 99 }
        output.push({ category, label: meta.label, icon: meta.icon, items })
      }

      output.sort((a, b) => {
        const orderA = webSearchCategories[a.category]?.order ?? 99
        const orderB = webSearchCategories[b.category]?.order ?? 99
        return orderA - orderB
      })

      return Promise.resolve(output)
    },
    getDocumentCount: (): Promise<number> => {
      return Promise.resolve(webSearchDocuments.size)
    }
  }

  const api: CoreUiApi = {
    platform: (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? 'web',
    theme: themeApi,
    i18n: i18nApi,
    logger: {
      // In web builds, swallow log messages; the app can add its own logging if desired.
      // We intentionally avoid using console here to keep logging centralized.
      log: () => Promise.resolve()
    },
    storage: storageApi,
    feature: featureApi,
    file: fileApi,
    eventBus: eventBusApi,
    search: searchApi,
    minimizeWindow: () => Promise.resolve(),
    maximizeWindow: () => Promise.resolve(),
    closeWindow: () => Promise.resolve(),
    toggleDeveloperTools: () => Promise.resolve(),
    setWindowTitle: () => Promise.resolve(),
    getWindowIcon: () => Promise.resolve(undefined),
    getCursorScreenPoint: () => Promise.resolve({ x: 0, y: 0 }),
    getActiveWindowBounds: () => Promise.resolve({
      x: 0,
      y: 0,
      width: window.innerWidth || 0,
      height: window.innerHeight || 0
    }),
    getCurrentWindowBounds: () => Promise.resolve({
      x: 0,
      y: 0,
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
      windowId: 0
    }),
    createAuxWindow: () => Promise.resolve(),
    getWindowUnderCursor: () => Promise.resolve(null),
    sendWorkbenchTabToWindow: () => Promise.resolve(false),
    onWorkbenchTabDropped: () => () => {
      // no-op
    }
  }

  w['api'] = api
}
