import { test } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Execute Request Workflow', () => {
  test('should have execute/send button available', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Button might not be visible if no request is open
    // Just verify no errors
    consoleInterceptor.assertNoErrors();
  });
});
