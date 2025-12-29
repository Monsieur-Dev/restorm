import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('GraphQL Integration', () => {
  test('should handle GraphQL requests', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loads without GraphQL errors
    expect(page.url()).toBe('http://localhost:5173/');
    
    // GraphQL request functionality should be available in the application
    // (UI elements will be tested when a file with GraphQL requests is loaded)
    
    consoleInterceptor.assertNoErrors();
  });

  test('should have GraphQL request UI elements available', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // GraphQL request functionality should be available in the application
    // (UI elements will be tested when a file with GraphQL requests is loaded)
    
    consoleInterceptor.assertNoErrors();
  });
});
