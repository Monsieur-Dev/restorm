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
function parseShortcut(shortcut: string): ParsedShortcut {
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
function matchesShortcut(event: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const eventKey = normalizeEventKey(event)
  
  // Check modifiers
  if (parsed.ctrl !== (event.ctrlKey || event.metaKey)) return false
  if (parsed.alt !== event.altKey) return false
  if (parsed.shift !== event.shiftKey) return false
  if (parsed.meta !== event.metaKey) return false
  
  // Check the key itself
  return eventKey === parsed.key
}

/** Type for the electronAPI exposed by preload */
interface ElectronAPI {
  onKeyboardShortcut?: (cb: (shortcut: string) => void) => void
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

  constructor() {
    this.shortcuts = new Map()
    this.isListening = false
    this.ipcListenerRegistered = false
    this.boundHandler = this.handleKeyDown.bind(this)
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
    logger.debug('[KeyboardShortcutService] Started listening for shortcuts')
  }

  /**
   * Setup IPC listener for shortcuts sent from main process
   */
  private setupIPCListener(): void {
    if (this.ipcListenerRegistered) return
    
    const electronAPI = getElectronAPI()
    if (electronAPI?.onKeyboardShortcut) {
      electronAPI.onKeyboardShortcut((shortcut: string) => {
        logger.debug(`[KeyboardShortcutService] Received IPC shortcut: ${shortcut}`)
        this.triggerShortcut(shortcut)
      })
      this.ipcListenerRegistered = true
      logger.debug('[KeyboardShortcutService] IPC listener registered')
    }
  }

  /**
   * Stop listening for keyboard events
   */
  stopListening(): void {
    if (!this.isListening) return
    
    document.removeEventListener('keydown', this.boundHandler, { capture: true })
    this.isListening = false
    logger.debug('[KeyboardShortcutService] Stopped listening for shortcuts')
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
    
    logger.debug(`[KeyboardShortcutService] Registered shortcut: ${shortcut}`)
    
    // Auto-start listening when first shortcut is registered
    if (!this.isListening) {
      this.startListening()
    }
    
    return () => {
      this.shortcuts.delete(key)
      logger.debug(`[KeyboardShortcutService] Unregistered shortcut: ${shortcut}`)
      
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
        event.preventDefault()
        event.stopPropagation()
        
        logger.debug(`[KeyboardShortcutService] Triggered shortcut: ${entry.shortcut}`)
        
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
        logger.debug(`[KeyboardShortcutService] Triggered IPC shortcut: ${entry.shortcut}`)
        
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
    logger.debug('[KeyboardShortcutService] Cleared all shortcuts')
  }
}

/** Singleton instance of the KeyboardShortcutService */
export const keyboardShortcutService = new KeyboardShortcutService()
