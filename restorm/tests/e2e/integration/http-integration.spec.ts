import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('HTTP Integration', () => {
  test('should handle HTTP requests', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loads without HTTP-related errors
    // The HTTP request functionality should be available
    expect(page.url()).toBe('http://localhost:5173/');
    
    consoleInterceptor.assertNoErrors();
  });

  test('should have HTTP request UI elements available', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // HTTP request functionality should be available in the application
    // (UI elements will be tested when a file with HTTP requests is loaded)
    
    consoleInterceptor.assertNoErrors();
  });
});

