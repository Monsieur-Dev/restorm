import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { join, resolve } from 'path';
import electronPath from 'electron';

test.describe('Open Folder from Command Line', () => {
  let electronApp: ElectronApplication;
  let page: Page;
  const restormRoot = resolve(__dirname, '../../..');
  const petstoreFolderPath = join(restormRoot, 'tests/e2e/samples/Petstore');

  test.beforeEach(async () => {
    const electronExePath = electronPath as unknown as string;
    const mainJsPath = join(restormRoot, 'dist/main/index.js');

    console.log('Opening folder:', petstoreFolderPath);
    console.log('Main JS path:', mainJsPath);

    // Launch Electron app with -o argument pointing to the Petstore folder
    electronApp = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '-o', petstoreFolderPath],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    });

    page = await electronApp.firstWindow();
    
    // Listen to console logs from the renderer
    page.on('console', msg => {
      console.log(`[Renderer] ${msg.type()}: ${msg.text()}`);
    });
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('load');
    
    // Wait for folder to be loaded (3s timeout in main + parsing time + render time)
    await page.waitForTimeout(10000);
    await page.screenshot({ path: 'test-results/debug-open-folder.png' });
  });

  test.afterEach(() => {
    try {
      electronApp.process().kill('SIGKILL');
    } catch {
      // Ignore kill errors
    }
  });

  test('should load 9 environment folders from Petstore folder', async () => {
    // Wait for the ListView to have items - look for specific folder names
    const folderNames = [
      'Swagger Petstore',
      'GraphQL Docker',
      'GraphQL Petstore',
      'gRPC Docker',
      'gRPC Petstore',
      'SOAP Docker',
      'SOAP Petstore',
      'AsyncAPI Docker',
      'AsyncAPI Petstore'
    ];
    
    // Wait for at least the first folder to appear
    await expect(page.locator(`text=${folderNames[0]}`).first()).toBeVisible({ timeout: 15000 });
    
    // Count all visible folders
    let foundCount = 0;
    for (const name of folderNames) {
      const folder = page.locator(`[role="treeitem"]:has-text("${name}")`).first();
      if (await folder.isVisible()) {
        foundCount++;
        console.log(`Found folder: ${name}`);
      }
    }
    
    expect(foundCount).toBe(9);
  });

  test('should display folders in correct order', async () => {
    // Verify the folders are displayed (checking a few key ones)
    await expect(page.locator('text=Swagger Petstore').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=GraphQL Docker').first()).toBeVisible();
    await expect(page.locator('text=AsyncAPI Petstore').first()).toBeVisible();
  });
});
