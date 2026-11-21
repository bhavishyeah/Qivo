import { test, expect } from './helpers/fixtures.ts'
import { loginAs } from './helpers/mockApi.ts'

test('Access & Schedule picker selects a date and saves the chosen local time', async ({ page, api }) => {
  await loginAs(page)
  // Fix "today" so the calendar opens on March 2026 and the day label is stable.
  await page.clock.setFixedTime(new Date(2026, 2, 10, 8, 0))
  const form = api.addForm({ title: 'Scheduled form' }, [{ label: 'Name', type: 'SHORT_TEXT', required: false }])

  await page.goto(`/forms/${form.id}/edit`)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Access & Schedule/ }).click()

  const publish = page.locator('#s-publish')
  await expect(publish).toContainText('Select date and time')
  await publish.click()

  const dialog = page.getByRole('dialog', { name: /choose date and time/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /March 15th, 2026/ }).click()
  await dialog.getByRole('button', { name: 'PM' }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)

  // Default hour is 9, so 15 March at 9:00 PM = "2026-03-15T21:00" local.
  await expect(publish).toContainText('15 Mar 2026, 9:00 PM')

  await page.getByRole('button', { name: 'Save all' }).click()
  await expect(page.getByText('Settings saved.')).toBeVisible()

  const [save] = api.callsTo('PATCH', /\/settings$/)
  expect(save?.body?.scheduledPublishAt).toBe(new Date('2026-03-15T21:00').toISOString())
  expect(save?.body?.scheduledCloseAt).toBeNull()

  // The saved instant comes back as the same local wall-clock time.
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Access & Schedule/ }).click()
  await expect(page.locator('#s-publish')).toContainText('15 Mar 2026, 9:00 PM')
})
