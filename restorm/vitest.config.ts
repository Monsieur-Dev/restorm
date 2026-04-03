import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    globals: true,
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

