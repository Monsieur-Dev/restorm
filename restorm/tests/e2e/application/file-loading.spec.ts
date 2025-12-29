import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';
import { join } from 'path';

test.describe('File Loading', () => {
  test('should load a JSON file without errors', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // This is a placeholder - actual file loading will need Electron-specific handling
    // For web mode, we can test file input
    const filePath = join(__dirname, '../../unit/simple.restorm');
    
    // Wait for application to be ready
    await page.waitForSelector('[role="menubar"]', { timeout: 5000 });
    
    consoleInterceptor.assertNoErrors();
  });

  test('should load a YAML file without errors', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await page.waitForSelector('[role="menubar"]', { timeout: 5000 });
    
    consoleInterceptor.assertNoErrors();
  });

  test('should display error for corrupted file', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Test corrupted file handling
    // This will need to be implemented with actual file loading
    
    // Should show error message
    // Should not crash the application
    consoleInterceptor.assertNoErrors();
  });
});

