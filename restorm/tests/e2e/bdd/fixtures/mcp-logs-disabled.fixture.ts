import { restormBaseTest, expect } from '../../helpers/base-fixture'

interface McpLogsDisabledFixtures {
  petstoreFolderPath: string
}

/**
 * Fixture for the "MCP logs menu entry is disabled" E2E. Launches WITHOUT
 * `--mcp` (the base fixture default), so the embedded MCP server never starts
 * and the `View → MCP logs` entry must be disabled.
 */
export const test = restormBaseTest.extend<McpLogsDisabledFixtures>({
  petstoreFolderPath: async ({ restormRoot }, use) => {
    const { join } = await import('path')
    await use(join(restormRoot, 'tests/e2e/samples/Petstore'))
  }
})

export { expect }
