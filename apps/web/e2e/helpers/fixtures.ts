import { test as base, expect } from '@playwright/test'
import { installMockApi, type MockApi } from './mockApi.ts'

/**
 * `test` with an automatic `api` fixture: the in-memory API is installed before
 * every test body runs (also when the test does not name it), and the test
 * fails if the app called an endpoint the mock lacks.
 */
export const test = base.extend<{ api: MockApi }>({
  api: [
    async ({ page }, use) => {
      const api = await installMockApi(page)
      await use(api)
      expect(api.unhandled, 'requests with no mock handler').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
