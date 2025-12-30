import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { join, resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import * as yaml from 'yaml';
import electronPath from 'electron';

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
};

test.describe('Handlebars Transformations (Electron)', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  const restormRoot = resolve(__dirname, '../../..');
  const testDataDir = join(restormRoot, 'tests/temp-test-data');
  const testFilePath = join(testDataDir, 'handlebars-test.restorm');

  test.beforeAll(async () => {
    // Create temp directory and test file
    if (!existsSync(testDataDir)) {
      mkdirSync(testDataDir, { recursive: true });
    }
    
    // Write test data as YAML (default format for .restorm files)
    writeFileSync(testFilePath, yaml.stringify(testData));
    console.log('Test file created:', testFilePath);
    
    // Use the electron module path
    const electronExePath = electronPath as unknown as string;
    const mainJsPath = join(restormRoot, 'dist/main/index.js');

    console.log('Electron path:', electronExePath);
    console.log('Main JS path:', mainJsPath);
    console.log('Opening file:', testFilePath);

    // Launch Electron app with --open argument to load the file on start
    electronApp = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '--open', testFilePath],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    });

    // Wait for the main window
    page = await electronApp.firstWindow();
    
    // Wait for initial load
    await page.waitForLoadState('domcontentloaded');
    console.log('Page domcontentloaded');
    
    // Wait for did-finish-load
    await page.waitForLoadState('load');
    console.log('Page load complete');
    
    // Wait for app and file to be loaded (--open triggers file loading 2s after load)
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'test-results/debug-electron-after-open-arg.png' });
  });

  test.afterAll(() => {
    // Force kill Electron process (avoids unsaved changes dialog)
    try {
      electronApp.process().kill('SIGKILL');
    } catch {
      // Ignore kill errors
    }
    
    // Clean up test file
    try {
      if (existsSync(testFilePath)) {
        rmSync(testFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should resolve and update path params in URL tooltip', async () => {
    // Expand the folder "Test API"
    const folderRow = page.locator('[role="treeitem"]:has-text("Test API")').first();
    await expect(folderRow).toBeVisible({ timeout: 10000 });
    
    const chevron = folderRow.locator('.codicon-chevron-right, .codicon-chevron-down, [class*="chevron"]').first();
    if (await chevron.count() > 0) {
      await chevron.click();
    } else {
      await folderRow.dblclick();
    }
    await page.waitForTimeout(500);

    // Click on the request
    const requestItem = page.locator('text=Get User').first();
    await expect(requestItem).toBeVisible({ timeout: 5000 });
    await requestItem.click();

    // Wait for URL resolution
    await page.waitForTimeout(2000);
    
    // Verify the URL tooltip shows the original value
    const urlContainerBefore = page.locator('div[title]').filter({ hasText: '{{baseUrl}}' }).first();
    await expect(urlContainerBefore).toBeVisible({ timeout: 10000 });
    
    const titleBefore = await urlContainerBefore.getAttribute('title');
    console.log('URL title before edit:', titleBefore);
    expect(titleBefore).toContain('/users/12345');

    // Find the PATH PARAMS pane header and expand if collapsed
    const pathParamsPane = page.locator('text=PATH PARAMS').first();
    await expect(pathParamsPane).toBeVisible({ timeout: 5000 });
    
    const paneHeader = pathParamsPane.locator('..').locator('..');
    const isCollapsed = await paneHeader.locator('.pane-collapsed, [aria-expanded="false"]').count() > 0;
    if (isCollapsed) {
      await pathParamsPane.click();
      await page.waitForTimeout(500);
    }
    
    const pathParamsSection = page.locator('.params-table-root').first();
    await expect(pathParamsSection).toBeVisible({ timeout: 5000 });

    // The value cell uses RestormVariableInputBox which is a Monaco editor
    // Monaco editors display text in .view-line elements, input goes to hidden textarea
    // Find the Monaco editor that contains "12345" by looking at view-lines
    const monacoEditors = page.locator('.params-table .monaco-editor');
    const editorCount = await monacoEditors.count();
    console.log(`Found ${editorCount} Monaco editors in params table`);
    
    // Find the editor with "12345" content
    let targetEditor = null;
    for (let i = 0; i < editorCount; i++) {
      const editor = monacoEditors.nth(i);
      const text = await editor.locator('.view-line').first().textContent();
      console.log(`Monaco editor ${i} content: "${text}"`);
      if (text?.includes('12345')) {
        targetEditor = editor;
        break;
      }
    }
    
    expect(targetEditor).not.toBeNull();
    console.log('Found target Monaco editor with 12345');
    
    // Click on the editor and edit
    await targetEditor.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('99999');
    
    // Click outside to blur and trigger update
    await page.locator('.params-table th').first().click();
    
    // Wait for transformation to update
    await page.waitForTimeout(2000);

    // Check the URL tooltip is updated with the new value
    const urlContainerAfter = page.locator('div[title]').filter({ hasText: '{{baseUrl}}' }).first();
    const titleAfter = await urlContainerAfter.getAttribute('title');
    
    console.log('URL title after edit:', titleAfter);
    
    expect(titleAfter).toBeTruthy();
    expect(titleAfter).toContain('https://api.example.com');
    expect(titleAfter).toContain('/users/99999');
    expect(titleAfter).not.toContain('/users/12345');
  });
});
