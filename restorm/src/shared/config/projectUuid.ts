/**
 * Top-level property name under which restorm stamps the stable project
 * UUID into a `.restorm` file (or a folder-mode root index). Chosen long
 * before the library surfaced `uuidKey` as a config option, so we keep
 * the legacy name for file compatibility — every project saved by older
 * builds already uses it.
 *
 * Both the main process (via `ensureFileUuid` / `ensureFolderUuid` /
 * `FileService`) and the renderer (to extract the UUID from the loaded
 * content for per-project persistence keys) import this constant.
 * Change it only behind a disk-migration path — every existing project
 * file on disk would otherwise regenerate a fresh UUID on next open and
 * invalidate every per-project preference keyed by it.
 */
export const PROJECT_UUID_KEY = '_projectUuid'
