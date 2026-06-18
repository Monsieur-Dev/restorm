/**
 * KeyboardShortcutService - Global keyboard shortcut management
 *
 * Provides a centralized way to register and handle keyboard shortcuts
 * across the application. Supports modifier keys (Ctrl, Alt, Shift, Meta).
 */

import { logger } from './logger'

/** Parsed shortcut structure */
export interface ParsedShortcut {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

/** Shortcut handler function type */
export type ShortcutHandler = () => void | Promise<void>

/** Registered shortcut entry */
interface ShortcutEntry {
  shortcut: string
  parsed: ParsedShortcut
  handler: ShortcutHandler
  enabled: boolean
}

/**
 * Parse a shortcut string into its components
 * Supports formats like: "Ctrl+O", "Ctrl+Shift+S", "F2", "Delete", "Alt+F4"
 */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+').map(p => p.trim().toLowerCase())
  
  const result: ParsedShortcut = {
    key: '',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false
  }
  
  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        result.ctrl = true
        break
      case 'alt':
        result.alt = true
        break
      case 'shift':
        result.shift = true
        break
      case 'meta':
      case 'cmd':
      case 'command':
        result.meta = true
        break
      default:
        // This is the actual key
        result.key = part
        break
    }
  }
  
  return result
}

/**
 * Normalize a key from a keyboard event
 */
function normalizeEventKey(event: KeyboardEvent): string {
  const key = event.key.toLowerCase()
  
  // Handle special key mappings
  switch (key) {
    case 'delete':
    case 'del':
      return 'delete'
    case 'suppr':
      return 'delete'
    case 'escape':
    case 'esc':
      return 'escape'
    case ' ':
      return 'space'
    default:
      return key
  }
}

/**
 * Check if an event matches a parsed shortcut
 */
export function matchesShortcut(event: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const eventKey = normalizeEventKey(event)
  
  // Check modifiers. ctrl and meta are DISTINCT (parseShortcut maps
  // `ctrl`→ctrl, `cmd`/`meta`→meta), so match each against its own event
  // flag. The previous `parsed.ctrl !== (ctrlKey || metaKey)` conflated
  // them: a `cmd+…` shortcut never fired (a Cmd press set metaKey, which
  // made the ctrl check reject it), and `ctrl+…` could be ambiguous on
  // metaKey. Exact per-modifier comparison fixes both.
  if (parsed.ctrl !== event.ctrlKey) return false
  if (parsed.meta !== event.metaKey) return false
  if (parsed.alt !== event.altKey) return false
  if (parsed.shift !== event.shiftKey) return false
  
  // Check the key itself
  return eventKey === parsed.key
}

/** Type for the electronAPI exposed by preload */
interface ElectronAPI {
  onKeyboardShortcut?: (cb: (shortcut: string) => void) => void
  registerInterceptedShortcuts?: (shortcuts: string[]) => void
  isDevMode?: () => Promise<boolean>
}

/** Get the electronAPI from window */
function getElectronAPI(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
}

/**
 * KeyboardShortcutService class providing global shortcut management
 */
class KeyboardShortcutService {
  private shortcuts: Map<string, ShortcutEntry>
  private isListening: boolean
  private boundHandler: (event: KeyboardEvent) => void
  private ipcListenerRegistered: boolean
  private devModeInitialized: boolean
  /** Disposer for the dev-mode refresh shortcut, kept so clearAll can
   * unregister it + re-init cleanly (the latch used to leave it
   * orphaned). */
  private devModeDisposer: (() => void) | null

  constructor() {
    this.shortcuts = new Map()
    this.isListening = false
    this.ipcListenerRegistered = false
    this.devModeInitialized = false
    this.devModeDisposer = null
    this.boundHandler = this.handleKeyDown.bind(this)
  }
  
  /**
   * Notify main process of all registered shortcuts that need interception
   */
  private syncInterceptedShortcutsWithMain(): void {
    const electronAPI = getElectronAPI()
    if (electronAPI?.registerInterceptedShortcuts) {
      const shortcuts = this.getRegisteredShortcuts()
      electronAPI.registerInterceptedShortcuts(shortcuts)
    }
  }

  /**
   * Initialize dev mode shortcuts (Ctrl+Shift+R for refresh)
   */
  private async initDevModeShortcuts(): Promise<void> {
    if (this.devModeInitialized) return
    this.devModeInitialized = true
    
    const electronAPI = getElectronAPI()
    if (electronAPI?.isDevMode) {
      try {
        const isDevMode = await electronAPI.isDevMode()
        if (isDevMode) {
          // Register Ctrl+Shift+R for page refresh in dev mode. Keep the
          // disposer so clearAll can unregister it (it used to be
          // discarded, leaving a dangling registration after clearAll).
          this.devModeDisposer = this.register('Ctrl+Shift+R', () => {
            window.location.reload()
          })
        }
      } catch (error) {
        logger.warn('[KeyboardShortcutService] Failed to check dev mode:', { error: String(error) })
      }
    }
  }

  /**
   * Start listening for keyboard events
   */
  startListening(): void {
    if (this.isListening) return
    
    document.addEventListener('keydown', this.boundHandler, { capture: true })
    
    // Also listen for IPC shortcuts from main process
    this.setupIPCListener()
    
    this.isListening = true
  }

  /**
   * Setup IPC listener for shortcuts sent from main process
   */
  private setupIPCListener(): void {
    if (this.ipcListenerRegistered) return
    
    const electronAPI = getElectronAPI()
    if (electronAPI?.onKeyboardShortcut) {
      electronAPI.onKeyboardShortcut((shortcut: string) => {
        this.triggerShortcut(shortcut)
      })
      this.ipcListenerRegistered = true
    }
  }

  /**
   * Stop listening for keyboard events
   */
  stopListening(): void {
    if (!this.isListening) return
    
    document.removeEventListener('keydown', this.boundHandler, { capture: true })
    this.isListening = false
  }

  /**
   * Register a keyboard shortcut
   * @param shortcut Shortcut string (e.g., "Ctrl+O", "F2")
   * @param handler Function to call when shortcut is triggered
   * @returns Unregister function
   */
  register(shortcut: string, handler: ShortcutHandler): () => void {
    const normalizedShortcut = shortcut.toLowerCase()
    const parsed = parseShortcut(shortcut)
    
    // Generate a unique key for this registration
    const key = `${normalizedShortcut}-${Date.now()}-${Math.random()}`
    
    this.shortcuts.set(key, {
      shortcut: normalizedShortcut,
      parsed,
      handler,
      enabled: true
    })
    
    // Auto-start listening when first shortcut is registered
    if (!this.isListening) {
      this.startListening()
    }
    
    // Sync with main process so it knows which shortcuts to intercept
    this.syncInterceptedShortcutsWithMain()
    
    // Initialize dev mode shortcuts if not already done
    void this.initDevModeShortcuts()
    
    return () => {
      this.shortcuts.delete(key)
      
      // Sync with main process after unregistering
      this.syncInterceptedShortcutsWithMain()
      
      // Auto-stop listening when no shortcuts are registered
      if (this.shortcuts.size === 0) {
        this.stopListening()
      }
    }
  }

  /**
   * Handle keydown events
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Skip if target is an input element (unless it's a global shortcut)
    const target = event.target as HTMLElement
    const isInputElement = (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    )
    
    // For input elements, only allow shortcuts with Ctrl/Meta modifier
    // This prevents shortcuts from interfering with typing
    if (isInputElement && !event.ctrlKey && !event.metaKey) {
      return
    }
    
    // Find matching shortcuts
    for (const entry of this.shortcuts.values()) {
      if (!entry.enabled) continue
      
      if (matchesShortcut(event, entry.parsed)) {
        // Only prevent default and stop propagation if we have a matching handler
        // This allows other components (like Monaco editor) to handle their own shortcuts
        event.preventDefault()
        event.stopPropagation()
        
        try {
          const result = entry.handler()
          if (result instanceof Promise) {
            result.catch((error: unknown) => {
              logger.error(`[KeyboardShortcutService] Error in shortcut handler:`, { error: String(error) })
            })
          }
        } catch (error) {
          logger.error(`[KeyboardShortcutService] Error in shortcut handler:`, { error: String(error) })
        }
        
        // Only trigger the first matching shortcut
        return
      }
    }
    
  }

  /**
   * Trigger a shortcut by its string representation (used for IPC shortcuts)
   */
  triggerShortcut(shortcut: string): void {
    const normalizedShortcut = shortcut.toLowerCase()
    
    for (const entry of this.shortcuts.values()) {
      if (!entry.enabled) continue
      
      if (entry.shortcut === normalizedShortcut) {
        try {
          const result = entry.handler()
          if (result instanceof Promise) {
            result.catch((error: unknown) => {
              logger.error(`[KeyboardShortcutService] Error in shortcut handler:`, { error: String(error) })
            })
          }
        } catch (error) {
          logger.error(`[KeyboardShortcutService] Error in shortcut handler:`, { error: String(error) })
        }
        
        // Only trigger the first matching shortcut
        return
      }
    }
  }

  /**
   * Check if a shortcut is registered
   */
  hasShortcut(shortcut: string): boolean {
    const normalizedShortcut = shortcut.toLowerCase()
    for (const entry of this.shortcuts.values()) {
      if (entry.shortcut === normalizedShortcut) {
        return true
      }
    }
    return false
  }

  /**
   * Get all registered shortcuts
   */
  getRegisteredShortcuts(): string[] {
    const shortcuts = new Set<string>()
    for (const entry of this.shortcuts.values()) {
      shortcuts.add(entry.shortcut)
    }
    return Array.from(shortcuts)
  }

  /**
   * Clear all registered shortcuts
   */
  clearAll(): void {
    this.shortcuts.clear()
    this.stopListening()
    // Reset the dev-mode latch so a later initDevModeShortcuts re-registers
    // the refresh shortcut (the flag used to stay true after clearAll, so
    // the dev refresh was lost for the rest of the session). Drop the stale
    // disposer first.
    if (this.devModeDisposer) {
      this.devModeDisposer()
      this.devModeDisposer = null
    }
    this.devModeInitialized = false
  }
}

/** Singleton instance of the KeyboardShortcutService */
export const keyboardShortcutService = new KeyboardShortcutService()
