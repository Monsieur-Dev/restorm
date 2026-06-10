import winston from 'winston'
import { app } from 'electron'

interface LoggerConfig {
  isVerbose: boolean
  /** When true, NEVER attach a console transport — even in dev / `--verbose`.
   * For a headless / CLI run whose stdout is reserved for program output. */
  isQuiet: boolean
  logFile: string | null
  logFormat: 'json' | 'plain'
}

/**
 * Parse command line arguments to extract logger configuration
 */
function parseLoggerConfig(): LoggerConfig {
  const args = process.argv
  const config: LoggerConfig = {
    isVerbose: false,
    isQuiet: false,
    logFile: null,
    logFormat: 'plain'
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    // Check for verbose flag
    if (arg === '--verbose' || arg === '-v') {
      config.isVerbose = true
    }

    // Check for quiet flag (suppress the console transport entirely)
    if (arg === '--quiet' || arg === '-q') {
      config.isQuiet = true
    }

    // Check for log file
    if ((arg === '--log-file' || arg === '-l') && i + 1 < args.length) {
      config.logFile = args[i + 1] ?? null
      i++ // Skip next argument as it's the file path
    }
    
    // Check for log format
    if ((arg === '--log-format' || arg === '-lf') && i + 1 < args.length) {
      const format = args[i + 1]
      if (format === 'json' || format === 'plain') {
        config.logFormat = format
      }
      i++ // Skip next argument as it's the format
    }
  }

  return config
}

/**
 * Create Winston logger instance with appropriate configuration
 */
function createLogger(): winston.Logger {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  const config = parseLoggerConfig()

  // Determine log level
  const level = isDev ? 'debug' : 'info'

  // Console format (always colorized)
  const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf((info): string => {
      const { timestamp, level, message, ...meta } = info as { timestamp: string; level: string; message: string; [key: string]: unknown }
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
      return `${timestamp} [${level}]: ${message}${metaStr}`
    })
  )

  // File format (json or plain based on config)
  const fileFormat = config.logFormat === 'json'
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    : winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf((info): string => {
          const { timestamp, level, message, ...meta } = info as { timestamp: string; level: string; message: string; [key: string]: unknown }
          const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
          return `${timestamp} [${level}]: ${message}${metaStr}`
        })
      )

  // Configure transports
  const transports: winston.transport[] = []

  // Add console transport if in dev or verbose is enabled — unless `--quiet`,
  // which reserves stdout for program output (headless / CLI runs).
  if ((isDev || config.isVerbose) && !config.isQuiet) {
    transports.push(
      new winston.transports.Console({
        format: consoleFormat,
        level
      })
    )
  }

  // Add file transport if log file is specified
  if (config.logFile) {
    transports.push(
      new winston.transports.File({
        filename: config.logFile,
        format: fileFormat,
        level
      })
    )
  }

  // Winston prints "Attempt to write logs with no transports, which can
  // increase memory usage" — to stderr, on EVERY log call — whenever the
  // transport list is empty. That happens in two real configurations: a
  // headless `--quiet` run with no `--log-file`, and a packaged production
  // build (no console in dev, not verbose, no file). Attach a silent no-op
  // transport so the warning never fires; it discards every record, keeping
  // stdout/stderr clean and adding no buffering.
  if (transports.length === 0) {
    transports.push(new winston.transports.Console({ silent: true }))
  }

  return winston.createLogger({
    level,
    transports
  })
}

// Create singleton logger instance
let loggerInstance: winston.Logger | null = null

/**
 * Get or create the logger instance
 */
function getLogger(): winston.Logger {
  loggerInstance ??= createLogger()
  return loggerInstance
}

/** Severity threshold accepted by {@link LoggerInterface.setLevel}. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

// Define logger interface for proper type inference
export interface LoggerInterface {
  debug: (message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
  /**
   * Override the active log level at runtime, on the logger AND every transport
   * (so a transport pinned to a lower level is raised too). Useful for a
   * headless / CLI run that must keep diagnostic output off stdout — e.g.
   * `logger.setLevel('error')` before the run so only errors surface.
   */
  setLevel: (level: LogLevel) => void
}

// Export logging functions
export const logger: LoggerInterface = {
  debug: (message: string, meta?: Record<string, unknown>): void => {
    getLogger().debug(message, meta)
  },
  info: (message: string, meta?: Record<string, unknown>): void => {
    getLogger().info(message, meta)
  },
  warn: (message: string, meta?: Record<string, unknown>): void => {
    getLogger().warn(message, meta)
  },
  error: (message: string, meta?: Record<string, unknown>): void => {
    getLogger().error(message, meta)
  },
  setLevel: (level: LogLevel): void => {
    const instance = getLogger()
    instance.level = level
    for (const transport of instance.transports) transport.level = level
  }
}

export default logger
