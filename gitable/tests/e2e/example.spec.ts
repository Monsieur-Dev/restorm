import { test, expect } from '@playwright/test';

test.describe('Application Loading', () => {
  test('should load the application successfully', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the application to load
    await page.waitForLoadState('networkidle');
    
    // Check that the page has loaded
    expect(page.url()).toBe('http://localhost:5173/');
  });

  test('should have a title', async ({ page }) => {
    await page.goto('/');
    
    // Check that the page has a title
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});

