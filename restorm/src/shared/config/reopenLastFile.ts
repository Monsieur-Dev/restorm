/**
 * Storage key under which restorm records the path of the currently-open file
 * when the `files:reopenLastFile` user setting is enabled. The renderer writes
 * it (on open) / clears it (on close or when the setting is turned off); the
 * main process reads it on startup to reopen that file when no file was passed
 * on the command line. Both sides go through the same `StorageService`, so the
 * key must match — hence this shared constant.
 */
export const REOPEN_LAST_FILE_STORAGE_KEY = 'restorm:reopen-last-file-path'

/** The user setting that gates the behaviour (group `files`, id `reopenLastFile`). */
export const REOPEN_LAST_FILE_SETTING_KEY = 'files:reopenLastFile'
