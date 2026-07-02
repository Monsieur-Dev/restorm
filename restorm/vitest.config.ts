import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    globals: true,
    // The vitest default (5000ms) is tight for a single test in isolation,
    // but this suite runs 300+ files in parallel worker threads; under that
    // contention the OS occasionally starves a worker of CPU for a few
    // seconds, and any `await` mid-test can eat that stall. Observed across
    // several unrelated files (a mocked exec dispatch, an AbortSignal
    // bridge, a dynamic-import fixture lookup) — not a defect in any one of
    // them, each passes in well under a second run standalone. 20s absorbs
    // realistic full-suite scheduling noise without masking a genuine hang.
    testTimeout: 20000,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: 'coverage/unit',
      all: true,
      // Keep unit coverage on Node-friendly code.
      // Renderer UI coverage is collected via Playwright E2E coverage (coverage:e2e).
      include: [
        'src/main/**/*.{ts,tsx}',
        'src/preload/**/*.{ts,tsx}',
        'src/shared/**/*.{ts,tsx}'
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/dist/**',
        '**/node_modules/**',
        '**/tests/**',
        '**/test-results/**'
      ],
      thresholds: {
        lines: 25,
        functions: 20,
        branches: 15,
        statements: 25
      }
    }
  }
})

