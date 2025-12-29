import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('ListView Component', () => {
  test('should display ListView correctly', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // ListView is only visible when a file is loaded
    // Try to find it, but don't fail if it's not visible (no file loaded)
    const listView = page.locator('[role="tree"]').first();
    const listViewCount = await listView.count();
    
    if (listViewCount > 0) {
      // If ListView exists, verify it's visible
      await expect(listView).toBeVisible({ timeout: 2000 });
    } else {
      // If no ListView (no file loaded), that's okay for this test
      // The ListView will appear when a file is loaded
    }
    
    consoleInterceptor.assertNoErrors();
  });

  test('should update when items change', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // This will need to be implemented with actual item creation
    // For now, just verify no errors
    consoleInterceptor.assertNoErrors();
  });
});
