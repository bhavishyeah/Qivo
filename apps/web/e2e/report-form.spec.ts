import { test, expect } from './helpers/fixtures.ts'
import { addPublishedForm } from './helpers/mockApi.ts'

test('report-a-form modal validates and shows success', async ({ page, api }) => {
  const form = addPublishedForm(api, { title: 'Suspicious fee' }, [
    { label: 'Your name', type: 'SHORT_TEXT', required: false },
  ])
  await page.goto(`/f/${form.slug}`)

  await page.getByRole('button', { name: 'Report this form' }).click()
  const dialog = page.getByRole('dialog', { name: 'Report this form' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Send report' }).click()
  await expect(dialog.getByText('Choose a reason for your report.')).toBeVisible()

  await dialog.getByText('Looks like a scam or wrong UPI ID').click()
  await dialog.getByLabel('Your email (optional)').fill('not-an-email')
  await dialog.getByRole('button', { name: 'Send report' }).click()
  await expect(dialog.getByText('Enter a valid email address.')).toBeVisible()
  expect(api.reports).toHaveLength(0)

  await dialog.getByLabel('Your email (optional)').fill('person@example.com')
  await dialog.getByLabel('Details (optional)').fill('The UPI ID belongs to someone else.')
  await dialog.getByRole('button', { name: 'Send report' }).click()

  await expect(dialog.getByRole('status')).toHaveText('Thanks, we will review this form.')
  expect(api.reports).toHaveLength(1)
  expect(api.reports[0]).toMatchObject({
    slug: form.slug,
    reason: 'SCAM',
    reporterEmail: 'person@example.com',
    details: 'The UPI ID belongs to someone else.',
  })

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})
