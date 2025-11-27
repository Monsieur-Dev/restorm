import winston from 'winston'
import { app } from 'electron'

interface LoggerConfig {
  isVerbose: boolean
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
    logFile: null,
    logFormat: 'plain'
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    // Check for verbose flag
    if (arg === '--verbose' || arg === '-v') {
      config.isVerbose = true
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
      const { timestamp, level, message, ...meta } = info
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
      return `${String(timestamp)} [${String(level)}]: ${String(message)}${metaStr}`
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
          const { timestamp, level, message, ...meta } = info
          const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
          return `${String(timestamp)} [${String(level)}]: ${String(message)}${metaStr}`
        })
      )

  // Configure transports
  const transports: winston.transport[] = []

  // Add console transport if in dev or verbose is enabled
  if (isDev || config.isVerbose) {
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
  if (!loggerInstance) {
    loggerInstance = createLogger()
  }
  return loggerInstance
}

// Define logger interface for proper type inference
export interface LoggerInterface {
  debug: (message: string, meta?: Record<string, unknown>) => void
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
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
  }
}

export default logger

