import { test, expect } from '@playwright/test';
import { compareVisual } from '../helpers/visual-comparison';

test.describe('Component Screenshots', () => {
  test('should capture main application screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await compareVisual(page, 'main-application');
  });

  test('should capture ListView screenshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const listView = page.locator('[data-testid="listview"], .list-view, [role="tree"]').first();
    if (await listView.count() > 0) {
      await expect(listView).toBeVisible();
      await compareVisual(page, 'listview');
    }
  });
});

