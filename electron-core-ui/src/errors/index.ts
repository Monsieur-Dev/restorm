// ==========================================================================
// Error Codes
// ==========================================================================

export type FileSystemErrorCode =
  | 'FS_READ_FAILED'
  | 'FS_WRITE_FAILED'
  | 'FS_NOT_FOUND'
  | 'FS_PARSE_FAILED'
  /** The target file exists and this process may not write to it. */
  | 'FS_TARGET_READ_ONLY'

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
// Save-failure classification
// ==========================================================================

interface ErrorWithCause extends Error {
  cause?: unknown
}

/**
 * Why a write to disk failed, in terms a user can act on. "The file is
 * read-only" tells them what to change; "save failed" tells them nothing,
 * and a save that fails without a remedy is one they will retry forever.
 */
export type SaveFailureReason =
  /** The target file itself is marked read-only. */
  | 'read-only-file'
  /** The whole filesystem is mounted read-only. */
  | 'read-only-location'
  /** The containing directory (or an ancestor) refuses the write. */
  | 'permission-denied'
  | 'disk-full'
  | 'quota-exceeded'
  /** The path vanished — a deleted folder, an unplugged removable drive. */
  | 'path-missing'
  /** Another process holds the file. */
  | 'file-busy'
  | 'unknown'

const REASON_BY_CODE: Record<string, SaveFailureReason> = {
  FS_TARGET_READ_ONLY: 'read-only-file',
  EROFS: 'read-only-location',
  EACCES: 'permission-denied',
  EPERM: 'permission-denied',
  ENOSPC: 'disk-full',
  EDQUOT: 'quota-exceeded',
  ENOENT: 'path-missing',
  ENOTDIR: 'path-missing',
  ENODEV: 'path-missing',
  ENXIO: 'path-missing',
  EBUSY: 'file-busy',
  ETXTBSY: 'file-busy'
}

/**
 * Map a thrown write error to a {@link SaveFailureReason}. Walks the
 * `cause` chain — the errno lives on the original `fs` error, which
 * callers routinely wrap in a {@link FileSystemError} before rethrowing.
 * Unrecognised (or absent) codes collapse to `'unknown'`, whose message
 * is expected to carry the raw error text instead.
 */
export function classifySaveFailure(error: unknown): SaveFailureReason {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') {
      const reason = REASON_BY_CODE[code]
      if (reason !== undefined) return reason
    }
    current = (current as ErrorWithCause).cause
  }
  return 'unknown'
}

// ==========================================================================
// Error Logging Helper
// ==========================================================================

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
