import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';

test.describe('Application Launch', () => {
  test('should load the application successfully', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).toBe('http://localhost:5173/');
    consoleInterceptor.assertNoErrors();
  });

  test('should have a title', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('should not have console errors on launch', async ({ page }) => {
    const consoleInterceptor = setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    consoleInterceptor.assertNoErrors();
    consoleInterceptor.assertNoWarnings();
  });
});
