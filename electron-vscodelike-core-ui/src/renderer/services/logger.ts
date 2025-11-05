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
    // Fallback to stderr if IPC fails, to avoid using console in renderer
    const messageToWrite = `Failed to send log to main process: ${String(error)}\n`
    try {
      process.stderr.write(messageToWrite)
    } catch {
      // Swallow as last resort
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

