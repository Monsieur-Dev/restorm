import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('ListView Component', () => {
  test('should display ListView correctly', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Wait for ListView to be visible
    const listView = page.locator('[data-testid="listview"], .list-view, [role="tree"]').first();
    await expect(listView).toBeVisible({ timeout: 5000 });
    
    consoleInterceptor.assertNoErrors();
  });

  test('should update when items change', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // This will need to be implemented with actual item creation
    // For now, just verify no errors
    consoleInterceptor.assertNoErrors();
  });
});

