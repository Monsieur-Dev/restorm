/**
 * EventBusService - Asynchronous pub/sub event system (Main Process)
 *
 * Provides a decoupled way for services to communicate
 * through events without direct dependencies.
 * Runs in the main process and can broadcast to renderer processes.
 */

import { BrowserWindow } from 'electron'
import { logger } from './LoggerService'
import { IpcError, errorMeta } from '../../errors'

/** Event handler function type */
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>

/** Subscription that can be used to unsubscribe */
export interface Subscription {
  unsubscribe: () => void
}

/**
 * EventBusService class providing pub/sub functionality in the main process
 */
class EventBusServiceImpl {
  private handlers: Map<string, Set<EventHandler>>

  constructor() {
    this.handlers = new Map()
  }

  /**
   * Subscribe to an event (main process only)
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
   * Emit an event asynchronously to main process handlers
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
        const wrappedError = new IpcError(`Error in handler for event "${event}"`, 'IPC_HANDLER_FAILED', { cause: error })
        logger.error(`[EventBus] Error in handler for event "${event}":`, errorMeta(wrappedError))
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
    setImmediate(() => {
      this.emit(event, payload).catch((error: unknown) => {
        const wrappedError = new IpcError(`Unhandled error in emit for "${event}"`, 'IPC_EMIT_FAILED', { cause: error })
        logger.error(`[EventBus] Unhandled error in emit for "${event}":`, errorMeta(wrappedError))
      })
    })
  }

  /**
   * Broadcast an event to all renderer windows
   * @param channel IPC channel name
   * @param payload Data to send to renderers
   */
  broadcast(channel: string, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
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
export const eventBusService = new EventBusServiceImpl()
