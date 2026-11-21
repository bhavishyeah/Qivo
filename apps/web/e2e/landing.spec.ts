import { test, expect } from './helpers/fixtures.ts'
import { loginAs } from './helpers/mockApi.ts'

test.describe('landing page', () => {
  test('loads and the call to action goes to registration', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await page.getByRole('link', { name: 'Get started' }).first().click()

    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByLabel('Full name')).toBeVisible()
  })

  test('a logged-in visitor is redirected to the dashboard', async ({ page, api }) => {
    await loginAs(page)
    api.addForm({ title: 'Existing form' })

    await page.goto('/')

    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: 'Your forms' })).toBeVisible()
  })
})
