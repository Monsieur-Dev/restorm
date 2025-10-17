/**
 * Logger service for the renderer process
 * Sends log messages to the main process via IPC
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Send a log message to the main process
 */
async function log(level: LogLevel, message: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    await window.api.logger.log(level, `[Renderer] ${message}`, meta)
  } catch (error) {
    // Fallback to console if IPC fails (only in this error handler, unavoidable)
    // We need console here as the IPC channel failed
    if (typeof console !== 'undefined' && console.error) {
      console.error('Failed to send log to main process:', error)
    }
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>): void => {
    void log('debug', message, meta)
  },
  info: (message: string, meta?: Record<string, unknown>): void => {
    void log('info', message, meta)
  },
  warn: (message: string, meta?: Record<string, unknown>): void => {
    void log('warn', message, meta)
  },
  error: (message: string, meta?: Record<string, unknown>): void => {
    void log('error', message, meta)
  }
}

export default logger

