import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import * as yaml from 'yaml'
import { listViewRootSelector } from 'electron-core-ui/testing'
import { restormBaseTest, expect, writeAppLogs } from '../../helpers/base-fixture'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E } from '../../helpers/coverage'

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
  testFilePath: string
}

export const test = restormBaseTest.extend<HandlebarsFixtures>({
  testFilePath: async ({ restormRoot }, use) => {
    const testDataDir = join(restormRoot, 'tests/temp-test-data')
    const testFilePath = join(testDataDir, 'handlebars-test.restorm')

    if (!existsSync(testDataDir)) {
      mkdirSync(testDataDir, { recursive: true })
    }
    writeFileSync(testFilePath, yaml.stringify(testData))

    await use(testFilePath)

    try {
      if (existsSync(testFilePath)) {
        rmSync(testFilePath)
      }
    } catch {
      // Ignore cleanup errors
    }
  },

  electronApp: async ({ restormRoot, testFilePath }, use, testInfo) => {
    const app = await launchRestormElectronApp({
      restormRoot,
      args: ['--open', testFilePath]
    })
    await use(app)
    const logFile = writeAppLogs(app, testInfo.outputDir)
    if (logFile) {
      await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
    }
    await closeElectronAppForE2E(app)
  },

  page: async ({ electronApp, restormRoot }, use, testInfo) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForSelector(`${listViewRootSelector('sidebar-listview')}[data-ready="true"]`, { timeout: 15000 })
    await use(page)
    const { writeRendererIstanbulCoverage } = await import('../../helpers/coverage')
    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect }
