import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 120000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true // Run tests sequentially to avoid port conflicts
      }
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: 'coverage/integration',
      all: true,
      // Keep integration coverage on Node-friendly modules and renderer services.
      // UI components are covered via Playwright E2E coverage (coverage:e2e).
      include: [
        'src/main/**/*.{ts,tsx}',
        'src/preload/**/*.{ts,tsx}',
        'src/shared/**/*.{ts,tsx}',
        'src/renderer/src/services/**/*.{ts,tsx}',
        'src/renderer/src/hooks/**/*.{ts,tsx}',
        'src/renderer/src/types/**/*.{ts,tsx}'
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/index.ts',
        '**/dist/**',
        '**/node_modules/**',
        '**/tests/**',
        '**/test-results/**'
      ]
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})
