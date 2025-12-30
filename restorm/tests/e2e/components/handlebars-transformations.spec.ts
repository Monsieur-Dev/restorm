import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Handlebars Transformations', () => {
  // Skip this test in web mode - data injection via setRootFolders is unreliable
  // Use the Electron tests in tests/e2e/electron/handlebars-electron.spec.ts instead
  test.skip('should display request with variables in ListView and show in workbench', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    // Capture console logs for debugging
    const consoleLogs: string[] = []
    page.on('console', msg => {
      if (msg.text().includes('[App]')) {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`)
      }
    })
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Wait for helpers to be available
    await page.evaluate(async () => {
      let retries = 50
      while (retries > 0) {
        const hasTestHelpers = !!(window as unknown as { __testHelpers?: unknown }).__testHelpers
        const hasRestormHelpers = !!(window as unknown as { __restormTestHelpers?: unknown }).__restormTestHelpers
        if (hasTestHelpers && hasRestormHelpers) break
        await new Promise(resolve => setTimeout(resolve, 200))
        retries--
      }
    });
    
    // Use setRootFolders directly to add data with variables
    const result = await page.evaluate(async () => {
      const restormHelpers = (window as unknown as { __restormTestHelpers?: { setRootFolders: (folders: unknown[]) => void } }).__restormTestHelpers
      if (!restormHelpers?.setRootFolders) {
        return { success: false, error: 'setRootFolders not available' }
      }
      
      const folders = [{
        id: 'test-env-folder-1',
        name: 'Test Collection',
        folderType: 'environment',
        documentation: '',
        notes: '',
        tags: [],
        configuration: {},
        environments: [{
          id: 'env-1',
          name: 'Production',
          variables: [
            { id: 'v1', key: 'baseUrl', value: 'https://prod.api.com', description: '', enabled: true },
            { id: 'v2', key: 'apiKey', value: 'key-123-456', description: '', enabled: true }
          ]
        }],
        items: [{
          id: 'req-1',
          name: 'Test Request',
          type: 'http',
          method: 'GET',
          url: '{{baseUrl}}/users?key={{apiKey}}',
          headers: [],
          params: [],
          pathParams: [],
          documentation: '',
          notes: '',
          tags: []
        }]
      }]
      
      try {
        restormHelpers.setRootFolders(folders)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    });
    
    if (!result.success) {
      throw new Error(`setRootFolders failed: ${result.error}`)
    }
    
    // Wait for React to render
    await page.waitForTimeout(3000);
    
    // Debug: print console logs
    console.log('Console logs:', consoleLogs)
    
    // Verify the folder is visible in the sidebar
    const folderItem = page.locator('[role="treeitem"]:has-text("Test Collection")').first();
    await expect(folderItem).toBeVisible({ timeout: 10000 });
    
    // Expand the folder to see the request (click on the chevron)
    const chevron = folderItem.locator('.codicon-chevron-right, .codicon-chevron-down').first();
    if (await chevron.count() > 0) {
      await chevron.click();
      await page.waitForTimeout(500);
    }
    
    // Look for the request in the expanded folder
    const requestItem = page.locator('[role="treeitem"]:has-text("Test Request")').first();
    await expect(requestItem).toBeVisible({ timeout: 5000 });
    
    // Click on the request to open it in a tab
    await requestItem.click();
    await page.waitForTimeout(1000);
    
    // The URL is displayed in a custom component, not a standard input
    // Look for elements containing the URL text
    const urlElement = page.locator('text={{baseUrl}}/users').first();
    await expect(urlElement).toBeVisible({ timeout: 5000 });
    
    // Get the URL value from the element or its parent
    const urlValue = await urlElement.textContent() ?? '';
    
    // In web mode, the URL should show the raw template (variables not resolved)
    // Because transformations happen in the main process (Electron only)
    expect(urlValue).toContain('{{baseUrl}}');
    expect(urlValue).toContain('{{apiKey}}');
    
    // Get the title attribute which might contain the resolved URL
    const resolvedUrl = await urlElement.getAttribute('title') ?? 'N/A';
    
    // The test validates that:
    // 1. Data with variables can be loaded
    // 2. The request appears in the ListView
    // 3. The request can be opened in a tab
    // 4. The URL is visible and contains the template
    console.log('URL value:', urlValue);
    console.log('Resolved URL (title):', resolvedUrl);
    
    consoleInterceptor.assertNoErrors();
  });
});
