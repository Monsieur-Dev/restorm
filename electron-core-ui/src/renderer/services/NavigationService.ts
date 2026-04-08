/**
 * NavigationService
 *
 * Provides navigation management with history support (back/forward).
 * This service allows different parts of the UI to coordinate navigation state.
 *
 * ## Usage
 *
 * ```typescript
 * import { navigationService } from 'electron-core-ui/renderer'
 *
 * // Navigate to an item
 * navigationService.navigateTo('request-123', 'sidebar', { type: 'http-request' })
 *
 * // Listen for navigation events
 * const unsubscribe = navigationService.onNavigate((event) => {
 *   console.log('Navigated to:', event.key, 'from:', event.source)
 * })
 *
 * // Navigate back/forward
 * navigationService.goBack()
 * navigationService.goForward()
 *
 * // Check if back/forward is available
 * if (navigationService.canGoBack()) { ... }
 * if (navigationService.canGoForward()) { ... }
 * ```
 *
 * ## Navigation Flow
 *
 * 1. A component calls `navigateTo()` with a key, source, and optional params
 * 2. The navigation is added to history
 * 3. An `onNavigate` event is emitted
 * 4. All subscribed components react to the navigation event
 *
 * This allows:
 * - Sidebar to highlight the selected item when workbench tab changes
 * - Workbench to open/focus tabs when sidebar item is clicked
 * - Back/forward buttons to work across all navigation sources
 */

import { logger } from './logger'

/** Parameters associated with a navigation target */
export interface NavigationParams {
  /** Type of the navigation target (e.g., 'folder', 'http-request') */
  type?: string
  /** Additional data associated with the navigation */
  [key: string]: unknown
}

/** Navigation event emitted when navigation occurs */
export interface NavigationEvent {
  /** Unique identifier of the navigation target */
  key: string
  /** Source component that triggered the navigation */
  source: string
  /** Additional parameters for the navigation */
  params: NavigationParams
  /** Whether this is a back/forward navigation */
  isHistoryNavigation: boolean
}

/** Entry in the navigation history */
export interface HistoryEntry {
  key: string
  source: string
  params: NavigationParams
}

/** Callback type for navigation event listeners */
export type NavigationListener = (event: NavigationEvent) => void

/** Callback type for history state change listeners */
export type HistoryStateListener = (canGoBack: boolean, canGoForward: boolean) => void

/**
 * NavigationService class
 *
 * Manages navigation state and history for the application.
 * Implements a browser-like back/forward navigation system.
 */
class NavigationService {
  /** Navigation history stack */
  private history: HistoryEntry[] = []

  /** Current position in the history stack */
  private currentIndex = -1

  /** Maximum number of entries to keep in history */
  private readonly maxHistorySize = 100

  /** Listeners for navigation events */
  private navigationListeners = new Set<NavigationListener>()

  /** Listeners for history state changes */
  private historyStateListeners = new Set<HistoryStateListener>()

  /**
   * Navigate to a target identified by key
   *
   * @param key - Unique identifier for the navigation target
   * @param source - Identifier of the component triggering the navigation
   * @param params - Additional parameters for the navigation
   */
  navigateTo(key: string, source: string, params: NavigationParams = {}): void {
    // Check if this is the same as current location
    const current = this.history[this.currentIndex]
    if (current?.key === key) {
      // Still emit event for components to react (e.g., tab focus)
      this.emitNavigationEvent(key, source, params, false)
      return
    }

    // Remove any forward history when navigating to a new location
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1)
    }

    // Add new entry to history
    const entry: HistoryEntry = { key, source, params }
    this.history.push(entry)
    this.currentIndex = this.history.length - 1

    // Enforce max history size
    if (this.history.length > this.maxHistorySize) {
      const removeCount = this.history.length - this.maxHistorySize
      this.history = this.history.slice(removeCount)
      this.currentIndex -= removeCount
    }

    // Emit navigation event
    this.emitNavigationEvent(key, source, params, false)

    // Notify history state change
    this.emitHistoryStateChange()
  }

  /**
   * Navigate back in history
   *
   * @returns true if navigation occurred, false if at beginning of history
   */
  goBack(): boolean {
    if (!this.canGoBack()) {
      return false
    }

    this.currentIndex--
    const entry = this.history[this.currentIndex]
    if (entry) {
      this.emitNavigationEvent(entry.key, 'history', entry.params, true)
      this.emitHistoryStateChange()
    }
    return true
  }

  /**
   * Navigate forward in history
   *
   * @returns true if navigation occurred, false if at end of history
   */
  goForward(): boolean {
    if (!this.canGoForward()) {
      return false
    }

    this.currentIndex++
    const entry = this.history[this.currentIndex]
    if (entry) {
      this.emitNavigationEvent(entry.key, 'history', entry.params, true)
      this.emitHistoryStateChange()
    }
    return true
  }

  /**
   * Check if back navigation is available
   */
  canGoBack(): boolean {
    return this.currentIndex > 0
  }

  /**
   * Check if forward navigation is available
   */
  canGoForward(): boolean {
    return this.currentIndex < this.history.length - 1
  }

  /**
   * Get the current navigation entry
   */
  getCurrentEntry(): HistoryEntry | null {
    return this.history[this.currentIndex] ?? null
  }

  /**
   * Subscribe to navigation events
   *
   * @param listener - Callback function to be called on navigation
   * @returns Unsubscribe function
   */
  onNavigate(listener: NavigationListener): () => void {
    this.navigationListeners.add(listener)
    return () => {
      this.navigationListeners.delete(listener)
    }
  }

  /**
   * Subscribe to history state changes
   *
   * @param listener - Callback function to be called when back/forward availability changes
   * @returns Unsubscribe function
   */
  onHistoryStateChange(listener: HistoryStateListener): () => void {
    this.historyStateListeners.add(listener)
    // Immediately call with current state
    listener(this.canGoBack(), this.canGoForward())
    return () => {
      this.historyStateListeners.delete(listener)
    }
  }

  /** Get the full navigation history */
  getHistory(): HistoryEntry[] {
    return [...this.history]
  }

  /** Get the number of entries in history */
  getHistorySize(): number {
    return this.history.length
  }

  /** Get the current position in history */
  getCurrentIndex(): number {
    return this.currentIndex
  }

  /**
   * Clear all navigation history
   */
  clearHistory(): void {
    this.history = []
    this.currentIndex = -1
    this.emitHistoryStateChange()
  }

  /** Emit a navigation event to all listeners */
  private emitNavigationEvent(
    key: string,
    source: string,
    params: NavigationParams,
    isHistoryNavigation: boolean
  ): void {
    const event: NavigationEvent = { key, source, params, isHistoryNavigation }
    for (const listener of this.navigationListeners) {
      try {
        listener(event)
      } catch (error) {
        logger.error('Error in navigation listener', { error: String(error) })
      }
    }
  }

  /** Emit history state change to all listeners */
  private emitHistoryStateChange(): void {
    const canGoBack = this.canGoBack()
    const canGoForward = this.canGoForward()
    for (const listener of this.historyStateListeners) {
      try {
        listener(canGoBack, canGoForward)
      } catch (error) {
        logger.error('Error in history state listener', { error: String(error) })
      }
    }
  }
}

/** Singleton instance of NavigationService */
export const navigationService = new NavigationService()

export default navigationService
