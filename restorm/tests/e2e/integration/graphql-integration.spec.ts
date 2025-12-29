import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('GraphQL Integration', () => {
  test('should handle GraphQL requests', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loads without GraphQL errors
    consoleInterceptor.assertNoErrors();
  });
});

