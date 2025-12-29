import type { Page } from '@playwright/test';

export interface ConsoleInterceptor {
  errors: string[];
  warnings: string[];
  assertNoErrors: () => void;
  assertNoWarnings: () => void;
}

export async function setupConsoleErrorInterceptor(page: Page): Promise<ConsoleInterceptor> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    } else if (msg.type() === 'warning') {
      warnings.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
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

