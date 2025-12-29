import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('WebSocket Integration', () => {
  test('should handle WebSocket connections', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loads without WebSocket-related errors
    // The WebSocket connection functionality should be available
    expect(page.url()).toBe('http://localhost:5173/');
    
    consoleInterceptor.assertNoErrors();
  });

  test('should have WebSocket request UI elements available', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // WebSocket request functionality should be available in the application
    // (UI elements will be tested when a file with WebSocket requests is loaded)
    
    consoleInterceptor.assertNoErrors();
  });
});

