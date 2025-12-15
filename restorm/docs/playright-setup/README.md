# Playwright Setup Documentation

## Overview

This document describes the Playwright end-to-end (E2E) testing setup for the restorm application. Playwright is configured to test the React renderer in a standard web browser environment, allowing for automated testing and easier style inspection.

## Architecture

### Web Standalone Mode

The application can now run in two modes:

1. **Electron Mode** (default): Full desktop application with Electron
   - Command: `pnpm dev`
   - Uses electron-vite configuration

2. **Web Standalone Mode**: React renderer only in a standard browser
   - Command: `pnpm dev:web`
   - Uses `vite.web.config.ts` configuration
   - Runs on `http://localhost:5173`

### Configuration Files

- **`playwright.config.ts`**: Main Playwright configuration
  - Configures test directory (`tests/e2e`)
  - Sets up Chromium as the default test browser
  - Configures base URL and web server
  - Enables parallel test execution
  - Includes retry logic for CI environments

- **`vite.web.config.ts`**: Vite configuration for web standalone mode
  - Configures the renderer to run independently
  - Sets up the same aliases as electron-vite
  - Exposes the application on port 5173

## Installation

Playwright and its dependencies are already installed. If you need to reinstall or install additional browsers:

```bash
# Install Playwright
pnpm add -D @playwright/test

# Install browsers
npx playwright install chromium
```

## Running Tests

### Basic Commands

```bash
# Run all tests in headless mode
pnpm test:e2e

# Run tests with UI mode (interactive)
pnpm test:e2e:ui

# Run tests in debug mode
pnpm test:e2e:debug
```

### Advanced Usage

```bash
# Run a specific test file
npx playwright test tests/e2e/example.spec.ts

# Run tests in headed mode (see the browser)
npx playwright test --headed

# Run tests in a specific browser
npx playwright test --project=chromium

# Generate a test
npx playwright codegen http://localhost:5173
```

## Writing Tests

Tests are located in the `tests/e2e/` directory. Here's a basic example:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    // Navigate to the application
    await page.goto('/');
    
    // Perform actions and assertions
    await page.click('button#my-button');
    await expect(page.locator('.result')).toHaveText('Expected Text');
  });
});
```

### Best Practices

1. **Use meaningful test descriptions**: Describe what the test does in plain English
2. **Use data-testid attributes**: Add `data-testid` attributes to elements for more reliable selectors
3. **Wait for elements**: Use `waitForSelector` or `waitForLoadState` when needed
4. **Group related tests**: Use `test.describe` to group related test cases
5. **Keep tests independent**: Each test should be able to run independently

## Test Structure

```
tests/
└── e2e/
    ├── example.spec.ts      # Example test file
    └── ...                  # Add more test files here
```

## Accessing VSCode Online for Styles

One of the benefits of the web standalone mode is the ability to easily inspect and copy styles from VSCode online:

1. Start the application in web mode:
   ```bash
   pnpm dev:web
   ```

2. Open your browser at `http://localhost:5173`

3. Open browser DevTools (F12)

4. Inspect elements to view and copy styles

5. Compare with VSCode online at `https://vscode.dev` to match styling

## Debugging Tests

### Using the Playwright Inspector

```bash
pnpm test:e2e:debug
```

This opens the Playwright Inspector, which allows you to:
- Step through tests
- See action logs
- Inspect the DOM
- View screenshots

### Using the Playwright UI Mode

```bash
pnpm test:e2e:ui
```

This opens an interactive UI that allows you to:
- Run tests with a visual interface
- See test results in real-time
- Debug failed tests
- View traces and screenshots

### Screenshots and Videos

Playwright is configured to:
- Take screenshots on test failure
- Record traces on first retry
- Store results in `test-results/` directory

## CI/CD Integration

The Playwright configuration is CI-ready:

- Tests run in parallel locally but sequentially in CI
- Automatic retries (2 times) in CI environments
- Strict mode enabled in CI (fails on `test.only`)
- HTML reporter for test results

To run tests in CI mode:

```bash
CI=1 pnpm test:e2e
```

## Troubleshooting

### Port Already in Use

If port 5173 is already in use:

1. Stop the process using the port
2. Or modify the port in `vite.web.config.ts` and `playwright.config.ts`

### Browser Installation Issues

If browsers fail to install:

```bash
# Install with dependencies
npx playwright install --with-deps chromium
```

### Tests Timing Out

If tests are timing out:

1. Increase timeout in `playwright.config.ts`:
   ```typescript
   use: {
     timeout: 60000, // 60 seconds
   }
   ```

2. Or increase webServer timeout:
   ```typescript
   webServer: {
     timeout: 180 * 1000, // 3 minutes
   }
   ```

## Next Steps

### Future Enhancements

1. **Electron Testing**: Add Playwright tests for the Electron application
   - Use `@playwright/test` with Electron launcher
   - Test desktop-specific features

2. **Visual Regression Testing**: Add screenshot comparison tests
   - Use Playwright's screenshot comparison features
   - Ensure UI consistency across changes

3. **Accessibility Testing**: Add automated accessibility tests
   - Use `@axe-core/playwright`
   - Ensure application meets accessibility standards

4. **Performance Testing**: Add performance monitoring
   - Measure load times
   - Track performance metrics

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright API Reference](https://playwright.dev/docs/api/class-playwright)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Vite Documentation](https://vitejs.dev)
