import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.tsx` is included so React component tests can run. The default
    // environment stays `node`; component tests opt into jsdom with a
    // per-file `// @vitest-environment jsdom` pragma, leaving the
    // existing node-oriented `.test.ts` suites unaffected.
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true
  }
})
