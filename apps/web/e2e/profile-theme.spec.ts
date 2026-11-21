import { test, expect } from './helpers/fixtures.ts'
import { loginAs } from './helpers/mockApi.ts'

test.beforeEach(async ({ page }) => {
  await loginAs(page)
})

async function chooseTheme(page: import('@playwright/test').Page, name: 'Light' | 'Dark' | 'System') {
  const trigger = page.getByRole('button', { name: 'Profile menu' })
  // Choosing a theme keeps the menu open, so only open it when it is closed.
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page.getByRole('menuitemradio', { name }).click()
}

test('Dark persists across a reload, and Light replaces it', async ({ page }) => {
  await page.goto('/dashboard')
  const html = page.locator('html')

  await chooseTheme(page, 'Dark')
  await expect(html).toHaveAttribute('data-color-scheme', 'dark')

  await page.reload()
  await expect(html).toHaveAttribute('data-color-scheme', 'dark')
  await page.getByRole('button', { name: 'Profile menu' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

  await chooseTheme(page, 'Light')
  await expect(html).toHaveAttribute('data-color-scheme', 'light')
  await page.reload()
  await expect(html).toHaveAttribute('data-color-scheme', 'light')
})

test('System follows the OS and clears the stored choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/dashboard')
  await chooseTheme(page, 'Light')
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')

  await chooseTheme(page, 'System')
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
  expect(await page.evaluate(() => window.localStorage.getItem('qivo-color-scheme'))).toBeNull()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
  await page.getByRole('button', { name: 'Profile menu' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
})
