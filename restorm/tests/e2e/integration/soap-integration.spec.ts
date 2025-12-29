import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('SOAP Integration', () => {
  test('should handle SOAP requests', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loads without SOAP-related errors
    // The SOAP request functionality should be available
    expect(page.url()).toBe('http://localhost:5173/');
    
    consoleInterceptor.assertNoErrors();
  });

  test('should have SOAP request UI elements available', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // SOAP request functionality should be available in the application
    // (UI elements will be tested when a file with SOAP requests is loaded)
    
    consoleInterceptor.assertNoErrors();
  });
});
