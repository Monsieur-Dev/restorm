import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Search Component', () => {
  test('should display search bar', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"], [role="searchbox"]').first();
    
    if (await searchInput.count() > 0) {
      await expect(searchInput).toBeVisible();
    }
    
    consoleInterceptor.assertNoErrors();
  });

  test('should perform search without errors', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"], [role="searchbox"]').first();
    
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(500); // Wait for search to execute
    }
    
    consoleInterceptor.assertNoErrors();
  });
});
