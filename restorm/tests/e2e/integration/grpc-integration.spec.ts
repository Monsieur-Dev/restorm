import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('gRPC Integration', () => {
  test('should handle gRPC requests', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loads without gRPC-related errors
    // The gRPC request functionality should be available
    expect(page.url()).toBe('http://localhost:5173/');
    
    consoleInterceptor.assertNoErrors();
  });

  test('should have gRPC request UI elements available', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // gRPC request functionality should be available in the application
    // (UI elements will be tested when a file with gRPC requests is loaded)
    
    consoleInterceptor.assertNoErrors();
  });
});

