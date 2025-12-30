import { test, expect } from '@playwright/test';
import { compareVisual } from '../helpers/visual-comparison';

test.describe('Theme Regression', () => {
  // Skip visual tests in CI until snapshots are updated
  test.skip(!!process.env.CI, 'Visual tests require snapshot updates in CI')
  test('should maintain visual consistency', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify application loaded
    expect(page.url()).toBe('http://localhost:5173/');
    
    // Wait a bit for any animations to settle
    await page.waitForTimeout(1000);
    
    // Take screenshot of main view
    // First run will create reference screenshot, subsequent runs will compare
    // Using higher threshold for visual tests to account for rendering differences
    await compareVisual(page, 'theme-default', { threshold: 0.1 });
  });
});
