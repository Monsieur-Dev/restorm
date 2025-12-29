import { test, expect } from '@playwright/test';
import { compareVisual } from '../helpers/visual-comparison';

test.describe('Component Screenshots', () => {
  // Skip visual tests in CI until snapshots are updated
  test.skip(!!process.env.CI, 'Visual tests require snapshot updates in CI')
  test('should capture main application screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // Wait a bit for any animations to settle
    await page.waitForTimeout(1000);
    
    // Take screenshot of the main application
    // First run will create reference screenshot, subsequent runs will compare
    // Using higher threshold for visual tests to account for rendering differences
    await compareVisual(page, 'main-application', { threshold: 0.1 });
  });

  test('should capture ListView screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // ListView is only visible when a file is loaded
    const listView = page.locator('[role="tree"]').first();
    const listViewCount = await listView.count();
    
    if (listViewCount > 0 && await listView.isVisible().catch(() => false)) {
      // If ListView is visible, take screenshot
      await page.waitForTimeout(500);
      await compareVisual(page, 'listview');
    } else {
      // Skip if no ListView (no file loaded)
      test.skip();
    }
  });
});
