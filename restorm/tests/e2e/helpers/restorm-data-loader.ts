import type { Page } from '@playwright/test';

/**
 * Helper to load Restorm data directly into the application for E2E tests
 * This bypasses file loading and directly injects data into the reactive store
 */
export async function loadRestormData(
  page: Page,
  restormData: {
    collections: {
      id: string
      name: string
      type: 'environmentFolder' | 'folder'
      environments?: {
        id: string
        name: string
        variables?: {
          id?: string
          key: string
          value: string
          description?: string
          enabled?: boolean
        }[]
      }[]
      items?: {
        id: string
        name: string
        type: 'httpRequest' | 'graphqlRequest' | 'grpcRequest' | 'soapRequest' | 'websocketRequest'
        httpMethod?: string
        url?: string
        [key: string]: unknown
      }[]
    }[]
  }
): Promise<void> {
  await page.evaluate(async (data) => {
    // Wait for test helpers to be available
    let retries = 10
    while (retries > 0 && !(window as unknown as { __testHelpers?: { loadRestormData: (data: typeof restormData) => Promise<void> } }).__testHelpers) {
      await new Promise(resolve => setTimeout(resolve, 100))
      retries--
    }
    
    const testHelpers = (window as unknown as { __testHelpers?: { loadRestormData: (data: typeof restormData) => Promise<void> } }).__testHelpers
    if (!testHelpers) {
      throw new Error('Test helpers not available. Make sure the application is running in dev mode.')
    }
    
    await testHelpers.loadRestormData(data)
  }, restormData)
  
  // Wait for data to be processed (list-view becomes ready)
  await page.waitForSelector('[data-testid="sidebar-listview"][data-ready="true"]', { timeout: 10000 })
}
