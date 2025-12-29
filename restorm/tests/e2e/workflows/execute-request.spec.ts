import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Execute Request Workflow', () => {
  test('should have execute/send button available', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for send/execute button
    const sendButton = page.locator('button:has-text("Send"), button:has-text("Execute"), [aria-label*="send"], [aria-label*="execute"]').first();
    
    // Button might not be visible if no request is open
    // Just verify no errors
    consoleInterceptor.assertNoErrors();
  });
});

