import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Error Handling', () => {
  test('should handle errors gracefully', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Application should still be functional even if some errors occur
    const body = page.locator('body');
    await expect(body).toBeVisible();
    
    // Critical errors should not occur
    const criticalErrors = consoleInterceptor.errors.filter(err => 
      err.includes('Uncaught') || err.includes('ReferenceError')
    );
    expect(criticalErrors.length).toBe(0);
  });
});
