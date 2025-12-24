/**
 * EventBus - Asynchronous pub/sub event system
 *
 * Provides a decoupled way for components and services to communicate
 * through events without direct dependencies.
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
 */
class EventBusService {
  private handlers: Map<string, Set<EventHandler>>

  constructor() {
    this.handlers = new Map()
  }

  /**
   * Subscribe to an event
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
   * Emit an event asynchronously
   * All handlers are called in parallel and errors are caught individually
   * @param event Event name to emit
   * @param payload Data to pass to handlers
   */
  async emit(event: string, payload: unknown): Promise<void> {
    const handlers = this.handlers.get(event)
    if (!handlers || handlers.size === 0) {
      return
    }

    // Execute all handlers in parallel
    const promises = Array.from(handlers).map(async (handler) => {
      try {
        await handler(payload)
      } catch (error) {
        // Log error but don't prevent other handlers from running
        logger.error(`[EventBus] Error in handler for event "${event}":`, { error: String(error) })
      }
    })

    await Promise.all(promises)
  }

  /**
   * Emit an event synchronously (fire and forget)
   * Handlers are executed asynchronously but emit returns immediately
   * @param event Event name to emit
   * @param payload Data to pass to handlers
   */
  emitSync(event: string, payload: unknown): void {
    // Use queueMicrotask for true async execution
    queueMicrotask(() => {
      this.emit(event, payload).catch((error: unknown) => {
        logger.error(`[EventBus] Unhandled error in emit for "${event}":`, { error: String(error) })
      })
    })
  }

  /**
   * Check if an event has any subscribers
   * @param event Event name to check
   */
  hasSubscribers(event: string): boolean {
    const handlers = this.handlers.get(event)
    return handlers !== undefined && handlers.size > 0
  }

  /**
   * Remove all subscribers for an event
   * @param event Event name to clear
   */
  clear(event: string): void {
    this.handlers.delete(event)
  }

  /**
   * Remove all subscribers for all events
   */
  clearAll(): void {
    this.handlers.clear()
  }
}

/** Singleton instance of the EventBus */
export const eventBus = new EventBusService()
