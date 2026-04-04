import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { restormBaseTest, expect } from '../../helpers/base-fixture'

interface ImportFixtures {
  tempFilePath: string
}

export const test = restormBaseTest.extend<ImportFixtures>({
  tempFilePath: async ({ restormRoot }, use) => {
    const tempDir = join(restormRoot, 'tests/e2e/temp')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }
    const tempFile = join(tempDir, 'import-temp.restorm')
    await use(tempFile)
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }

  // Uses default base electronApp (no args) and page
})

export { expect }
