import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function compareVisual(
  page: Page,
  componentName: string,
  options?: { threshold?: number }
): Promise<void> {
  await expect(page).toHaveScreenshot(`${componentName}.png`, {
    threshold: options?.threshold ?? 0.2,
    animations: 'disabled',
  });
}
