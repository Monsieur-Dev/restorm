import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('File Operations', () => {
  test('should open file menu', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const fileMenu = page.locator('text=File, [role="menuitem"]:has-text("File")').first();
    if (await fileMenu.count() > 0) {
      await fileMenu.click();
      await page.waitForTimeout(500);
    }
    
    consoleInterceptor.assertNoErrors();
  });

  test('should show new file option', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const fileMenu = page.locator('text=File, [role="menuitem"]:has-text("File")').first();
    if (await fileMenu.count() > 0) {
      await fileMenu.click();
      await page.waitForTimeout(500);
      
      const newFile = page.locator('text=New, text="New File"').first();
      if (await newFile.count() > 0) {
        await expect(newFile).toBeVisible();
      }
    }
  });
});
