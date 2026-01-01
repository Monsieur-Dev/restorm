import { test as base } from 'playwright-bdd'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import * as yaml from 'yaml'
import electronPath from 'electron'

// Test data with path params and variables in URL
const testData = {
  collections: [{
    id: 'folder-1',
    name: 'Test API',
    folderType: 'environment',
    documentation: '',
    notes: '',
    tags: [],
    configuration: {},
    environments: [{
      id: 'env-1',
      name: 'Production',
      variables: [
        { id: 'v1', key: 'baseUrl', value: 'https://api.example.com', description: '', enabled: true }
      ]
    }],
    items: [{
      id: 'req-1',
      name: 'Get User',
      type: 'http',
      method: 'GET',
      url: '{{baseUrl}}/users/{{userId}}',
      headers: [],
      params: [],
      pathParams: [
        { id: 'pp-1', key: 'userId', value: '12345', description: 'User ID', enabled: true }
      ],
      documentation: '',
      notes: '',
      tags: []
    }]
  }]
}

interface HandlebarsFixtures {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
  testFilePath: string
}

export const test = base.extend<HandlebarsFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  testFilePath: async ({ restormRoot }, use) => {
    const testDataDir = join(restormRoot, 'tests/temp-test-data')
    const testFilePath = join(testDataDir, 'handlebars-test.restorm')

    // Create temp directory and test file
    if (!existsSync(testDataDir)) {
      mkdirSync(testDataDir, { recursive: true })
    }
    writeFileSync(testFilePath, yaml.stringify(testData))

    await use(testFilePath)

    // Cleanup
    try {
      if (existsSync(testFilePath)) {
        rmSync(testFilePath)
      }
    } catch {
      // Ignore cleanup errors
    }
  },

  electronApp: async ({ restormRoot, testFilePath }, use) => {
    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const app = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '--open', testFilePath],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    await use(app)

    try {
      app.process().kill('SIGKILL')
    } catch {
      // Ignore kill errors
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForTimeout(4000)

    await use(page)
  }
})

export { expect } from '@playwright/test'
