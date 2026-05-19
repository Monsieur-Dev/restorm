// Side-effect CSS imports — Vite resolves them at bundle time. TS6
// stopped tolerating these without a declaration (TS2882). This file
// stays a script (no imports / exports) so the ambient `declare
// module` is treated as global, not as an augmentation that would
// only resolve under a specific module reference.

declare module '*.css' {
  const content: string
  export default content
}
