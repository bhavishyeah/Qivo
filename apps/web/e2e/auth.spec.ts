import { test, expect } from './helpers/fixtures.ts'
import { TEST_PASSWORD, TEST_USER } from './helpers/mockApi.ts'

test.describe('login', () => {
  test('signs in and lands on the dashboard', async ({ page, api }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USER.email)
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: 'Your forms' })).toBeVisible()
    expect(api.callsTo('POST', /\/api\/auth\/login$/)).toHaveLength(1)
  })

  test('shows the server message for wrong credentials and stays on the page', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USER.email)
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password.')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('register', () => {
  test('creates an account and lands on the dashboard', async ({ page, api }) => {
    await page.goto('/signup')
    await page.getByLabel('Full name').fill('New Person')
    await page.getByLabel('Email').fill('new@example.com')
    await page.getByLabel('Password').fill('a-strong-password')
    await page.getByRole('button', { name: /sign up|create account/i }).click()

    await expect(page).toHaveURL(/\/dashboard$/)
    const [call] = api.callsTo('POST', /\/api\/auth\/signup$/)
    expect(call?.body).toMatchObject({ name: 'New Person', email: 'new@example.com' })
  })

  test('shows the server message when the email is taken', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel('Full name').fill('Someone')
    await page.getByLabel('Email').fill('taken@example.com')
    await page.getByLabel('Password').fill('a-strong-password')
    await page.getByRole('button', { name: /sign up|create account/i }).click()

    await expect(page.getByRole('alert')).toHaveText('An account with this email already exists.')
    await expect(page).toHaveURL(/\/signup$/)
  })
})
