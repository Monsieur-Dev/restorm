import { test, expect } from '@playwright/test';
import { compareVisual } from '../helpers/visual-comparison';

test.describe('Theme Regression', () => {
  test('should maintain visual consistency', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Take screenshot of main view
    await compareVisual(page, 'theme-default');
  });
});

