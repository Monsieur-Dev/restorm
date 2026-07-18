/**
 * Resolve the absolute on-disk path for a `File` picked via a native
 * `<input type="file">` — Electron 32+ removed `File.path`; the
 * supported replacement is `webUtils.getPathForFile()`, exposed here
 * via the preload bridge as `restorm.file.getPathForFile` (the same
 * one the import modal's drag-drop already uses). Falls back to
 * `file.name` when the `File` isn't disk-backed (e.g. a Blob-backed
 * File, or a test double that doesn't implement the bridge).
 */
export function resolveFilePickerPath(file: File): string {
  const path = window.restorm?.file.getPathForFile(file) ?? ''
  return path.length > 0 ? path : file.name
}
