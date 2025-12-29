/**
 * EventBus - Client-side wrapper for the main process EventBus
 *
 * Provides the same API as the original EventBus but delegates
 * emit operations to the main process via IPC.
 * Local subscriptions in the renderer are still supported for UI-only events.
 */

import { logger } from './logger'

/** Event handler function type */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>

/** Subscription that can be used to unsubscribe */
export interface Subscription {
  unsubscribe: () => void
}

/**
 * EventBus class providing pub/sub functionality
 * Emits to main process, with local subscriptions for renderer-only events
 */
class EventBusService {
  private handlers: Map<string, Set<EventHandler>>

  constructor() {
    this.handlers = new Map()
  }

  /**
   * Subscribe to an event (local renderer only)
   * @param event Event name to subscribe to
   * @param handler Handler function to call when event is emitted
   * @returns Subscription object with unsubscribe method
   */
  subscribe<T = unknown>(event: string, handler: EventHandler<T>): Subscription {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }

    const handlers = this.handlers.get(event)
    if (handlers) {
      handlers.add(handler as EventHandler)
    }

    return {
      unsubscribe: () => {
        const currentHandlers = this.handlers.get(event)
        if (currentHandlers) {
          currentHandlers.delete(handler as EventHandler)
          if (currentHandlers.size === 0) {
            this.handlers.delete(event)
          }
        }
      }
    }
  }

  /**
   * Emit an event to the MAIN PROCESS asynchronously
   * @param event Event name to emit
   * @param payload Data to pass to handlers
   */
  async emit(event: string, payload: unknown): Promise<void> {
    // Emit to main process
    await window.api.eventBus.emit(event, payload)
  }

  /**
   * Emit an event to the MAIN PROCESS synchronously (fire and forget)
   * @param event Event name to emit
   * @param payload Data to pass to handlers
   */
  emitSync(event: string, payload: unknown): void {
    // Emit to main process (fire and forget)
    window.api.eventBus.emitSync(event, payload).catch((error: unknown) => {
      logger.error(`[EventBus] Error emitting to main process "${event}":`, { error: String(error) })
    })
  }

  /**
   * Emit an event locally in the renderer only (does NOT go to main process)
   * @param event Event name to emit
   * @param payload Data to pass to handlers
   */
  async emitLocal(event: string, payload: unknown): Promise<void> {
    const handlers = this.handlers.get(event)
    if (!handlers || handlers.size === 0) {
      return
    }

    const promises = Array.from(handlers).map(async (handler) => {
      try {
        await handler(payload)
      } catch (error) {
        logger.error(`[EventBus] Error in local handler for event "${event}":`, { error: String(error) })
      }
    })

    await Promise.all(promises)
  }

  /**
   * Emit an event locally in the renderer only (fire and forget)
   * @param event Event name to emit
   * @param payload Data to pass to handlers
   */
  emitLocalSync(event: string, payload: unknown): void {
    queueMicrotask(() => {
      this.emitLocal(event, payload).catch((error: unknown) => {
        logger.error(`[EventBus] Unhandled error in emitLocal for "${event}":`, { error: String(error) })
      })
    })
  }

  /**
   * Check if an event has any local subscribers
   * @param event Event name to check
   */
  hasSubscribers(event: string): boolean {
    const handlers = this.handlers.get(event)
    return handlers !== undefined && handlers.size > 0
  }

  /**
   * Remove all local subscribers for an event
   * @param event Event name to clear
   */
  clear(event: string): void {
    this.handlers.delete(event)
  }

  /**
   * Remove all local subscribers for all events
   */
  clearAll(): void {
    this.handlers.clear()
  }
}

/** Singleton instance of the EventBus */
export const eventBus = new EventBusService()
