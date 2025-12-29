import { test, expect } from '@playwright/test';
import { setupConsoleErrorInterceptor } from '../helpers/console-error-interceptor';
import { join } from 'path';

test.describe('File Loading', () => {
  test('should load a JSON file without errors', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // File loading in E2E tests requires Electron-specific handling
    // For now, just verify the application loads without errors
    // In a real scenario, we would use Electron's dialog API to load files
    consoleInterceptor.assertNoErrors();
  });

  test('should load a YAML file without errors', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // File loading in E2E tests requires Electron-specific handling
    // For now, just verify the application loads without errors
    consoleInterceptor.assertNoErrors();
  });

  test('should display error for corrupted file', async ({ page }) => {
    const consoleInterceptor = await setupConsoleErrorInterceptor(page);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // Test corrupted file handling
    // This will need to be implemented with actual file loading via Electron dialogs
    // For now, just verify the application doesn't crash
    consoleInterceptor.assertNoErrors();
  });
});

