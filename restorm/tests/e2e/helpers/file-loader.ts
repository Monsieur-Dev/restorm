import type { Page } from '@playwright/test';

export async function loadRestormFile(
  page: Page,
  filePath: string,
  _format: 'json' | 'yaml' | 'json5'
): Promise<void> {
  // Wait for file menu to be available
  await page.waitForSelector('[role="menubar"]', { timeout: 5000 });
  
  // Click File menu
  await page.click('text=File');
  
  // Click Open
  await page.click('text=Open');
  
  // Wait for file dialog (in Electron, this is handled differently)
  // For now, we'll use a file input if available
  const fileInput = page.locator('input[type="file"]');
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(filePath);
  } else {
    // In Electron, file dialogs are handled by the main process
    // We'll need to mock or use Electron-specific APIs
    throw new Error('File dialog not available in this context');
  }
  
  // Wait for file to load
  await page.waitForLoadState('networkidle');
  
  // Verify no errors
  const consoleErrors = await page.evaluate(() => {
    const windowWithErrors = window as typeof window & { __consoleErrors?: string[] };
    return windowWithErrors.__consoleErrors ?? [];
  });
  
  if (consoleErrors.length > 0) {
    throw new Error(`Errors during file load: ${consoleErrors.join(', ')}`);
  }
}
