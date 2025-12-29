import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Chaos Testing - Validation that tests detect failures', () => {
  test.skip('should fail when console error is introduced', async ({ page }) => {
    // This test is skipped by default - unskip to validate that tests detect failures
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Intentionally inject a console error
    await page.evaluate(() => {
      console.error('INTENTIONAL TEST ERROR - This should cause test to fail');
    });
    
    await page.waitForTimeout(100);
    
    // This test should fail
    consoleInterceptor.assertNoErrors();
  });

  test('should detect when component is missing', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Try to find a component that should exist
    const body = page.locator('body');
    await expect(body).toBeVisible();
    
    // If we remove body, test should fail
    // This is a basic validation that expect() works
  });
});
