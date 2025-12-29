import type { Page } from '@playwright/test';

export interface ConsoleInterceptor {
  errors: string[];
  warnings: string[];
  assertNoErrors: () => void;
  assertNoWarnings: () => void;
}

// Known errors to ignore (Vite build errors that don't affect runtime)
const IGNORED_ERROR_PATTERNS = [
  /Failed to resolve import.*electron-core-ui/,
  /Pre-transform error/,
  /Internal server error.*electron-core-ui/,
  /Failed to resolve import.*\.css/,
  /Failed to resolve import.*\.json/,
  /Failed to load resource: the server responded with a status of 500/,
  /the server responded with a status of 500/,
];

function shouldIgnoreError(errorText: string): boolean {
  return IGNORED_ERROR_PATTERNS.some(pattern => pattern.test(errorText));
}

export async function setupConsoleErrorInterceptor(page: Page): Promise<ConsoleInterceptor> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const errorText = msg.text();
      // Ignore known Vite build errors that don't affect runtime
      if (!shouldIgnoreError(errorText)) {
        errors.push(errorText);
      }
    } else if (msg.type() === 'warning') {
      warnings.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    const errorMessage = error.message;
    // Ignore known Vite build errors that don't affect runtime
    if (!shouldIgnoreError(errorMessage)) {
      errors.push(errorMessage);
    }
  });
  
  return {
    errors,
    warnings,
    assertNoErrors: () => {
      if (errors.length > 0) {
        throw new Error(`Console errors detected:\n${errors.join('\n')}`);
      }
    },
    assertNoWarnings: () => {
      if (warnings.length > 0) {
        throw new Error(`Console warnings detected:\n${warnings.join('\n')}`);
      }
    },
  };
}

