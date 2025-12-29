import { test } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Events Integration', () => {
  test('should handle events without errors', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Interact with UI to trigger events
    await page.click('body');
    await page.waitForTimeout(500);
    
    consoleInterceptor.assertNoErrors();
  });
});
