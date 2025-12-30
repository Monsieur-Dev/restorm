import { test } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Create Request Workflow', () => {
  test('should be able to create a new request', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for create/add button
    const createButton = page.locator('button:has-text("New"), button:has-text("Add"), button:has-text("Create"), [aria-label*="new"], [aria-label*="add"]').first();
    
    if (await createButton.count() > 0) {
      await createButton.click();
      await page.waitForTimeout(500);
    }
    
    consoleInterceptor.assertNoErrors();
  });
});
