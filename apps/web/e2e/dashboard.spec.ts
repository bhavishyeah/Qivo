import { test, expect } from './helpers/fixtures.ts'
import { loginAs } from './helpers/mockApi.ts'

test.beforeEach(async ({ page }) => {
  await loginAs(page)
})

test('creates a form from the template dropdown and opens the editor', async ({ page, api }) => {
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '+ New form' }).first().click()
  await expect(page).toHaveURL(/\/forms\/new$/)

  await page.getByLabel('Form title').fill('Spring Fest Feedback')
  await page.getByRole('button', { name: /Start from a template/ }).click()
  const listbox = page.getByRole('listbox')
  await expect(listbox.getByRole('option', { name: /Blank form/ })).toBeVisible()
  await listbox.getByRole('option', { name: /Event feedback/ }).click()
  await page.getByRole('button', { name: 'Create form' }).click()

  await expect(page).toHaveURL(/\/forms\/[^/]+\/edit$/)
  await expect(page.getByRole('button', { name: 'Spring Fest Feedback', exact: true })).toBeVisible()

  const [create] = api.callsTo('POST', /\/api\/forms\/from-template$/)
  expect(create?.body).toMatchObject({ title: 'Spring Fest Feedback', templateId: 'tpl-feedback' })
  await expect(page.getByText('2 questions').first()).toBeVisible()
})

test('clicking a form card opens its editor', async ({ page, api }) => {
  const form = api.addForm({ title: 'Volunteer sign-up' }, [{ label: 'Your name', type: 'SHORT_TEXT', required: true }])
  api.addForm({ title: 'Other form' })

  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: 'Other form', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Volunteer sign-up', exact: true }).click()

  await expect(page).toHaveURL(new RegExp(`/forms/${form.id}/edit$`))
  await expect(page.getByRole('button', { name: 'Volunteer sign-up', exact: true })).toBeVisible()
})
