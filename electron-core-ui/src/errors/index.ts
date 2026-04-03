// ==========================================================================
// Error Codes
// ==========================================================================

export type FileSystemErrorCode =
  | 'FS_READ_FAILED'
  | 'FS_WRITE_FAILED'
  | 'FS_NOT_FOUND'
  | 'FS_PARSE_FAILED'

export type PersistenceErrorCode =
  | 'PERSIST_LOAD_FAILED'
  | 'PERSIST_SAVE_FAILED'

export type IpcErrorCode =
  | 'IPC_EMIT_FAILED'
  | 'IPC_HANDLER_FAILED'

// ==========================================================================
// Error Classes
//
// We assign `cause` via Object.defineProperty to avoid conflicting
// `override` requirements between tsconfig.json (ES2022 Error.cause exists)
// and tsconfig.main.json (CommonJS target where it does not).
// ==========================================================================

export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly code: FileSystemErrorCode,
    options?: { cause?: unknown }
  ) {
    super(message)
    this.name = 'FileSystemError'
    if (options?.cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: options.cause, writable: false, enumerable: false })
    }
  }
}

export class PersistenceError extends Error {
  constructor(
    message: string,
    public readonly code: PersistenceErrorCode,
    options?: { cause?: unknown }
  ) {
    super(message)
    this.name = 'PersistenceError'
    if (options?.cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: options.cause, writable: false, enumerable: false })
    }
  }
}

export class IpcError extends Error {
  constructor(
    message: string,
    public readonly code: IpcErrorCode,
    options?: { cause?: unknown }
  ) {
    super(message)
    this.name = 'IpcError'
    if (options?.cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: options.cause, writable: false, enumerable: false })
    }
  }
}

// ==========================================================================
// Error Logging Helper
// ==========================================================================

interface ErrorWithCause extends Error {
  cause?: unknown
}

export function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCause = error as ErrorWithCause
    return {
      error: error.message,
      errorName: error.name,
      ...(errorWithCause.cause !== undefined
        ? { cause: errorWithCause.cause instanceof Error ? errorWithCause.cause.message : (errorWithCause.cause as string) }
        : {}),
      ...('code' in error ? { code: (error as { code: string }).code } : {})
    }
  }
  return { error: String(error) }
}
