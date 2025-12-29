import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('WCAG Validation', () => {
  test('should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('should have proper ARIA attributes', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Check for common interactive elements
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    
    // At least some buttons should have accessible names
    let accessibleButtons = 0;
    for (let i = 0; i < Math.min(buttonCount, 10); i++) {
      const button = buttons.nth(i);
      const ariaLabel = await button.getAttribute('aria-label');
      const text = await button.textContent();
      if (ariaLabel || text?.trim()) {
        accessibleButtons++;
      }
    }
    
    // Most buttons should be accessible
    expect(accessibleButtons).toBeGreaterThan(buttonCount * 0.7);
  });
});

