import { test, expect } from './helpers/fixtures.ts'
import { choiceOptions, loginAs, type MockApi } from './helpers/mockApi.ts'

// 1x1 transparent GIF, so the image editor renders without a network request.
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

test.beforeEach(async ({ page }) => {
  await loginAs(page)
})

function seedForm(api: MockApi) {
  return api.addForm({ title: 'Lunch survey' }, [
    { label: 'First question', type: 'SHORT_TEXT', required: false },
    { label: 'Second question', type: 'SHORT_TEXT', required: false },
    { label: 'Third question', type: 'SHORT_TEXT', required: false },
  ])
}

const toolbar = (page: import('@playwright/test').Page) => page.getByRole('toolbar', { name: 'Add to form' })
const card = (page: import('@playwright/test').Page, text: string) =>
  page.locator('article.editor-question').filter({ hasText: text })

test('adds a question from the toolbar and shows it open for editing', async ({ page, api }) => {
  const form = api.addForm({ title: 'Empty form' }, [{ label: 'Only question', type: 'SHORT_TEXT', required: false }])
  await page.goto(`/forms/${form.id}/edit`)

  await toolbar(page).getByRole('button', { name: 'Add question', exact: true }).click()

  await expect(page.getByRole('textbox', { name: 'Question title' })).toHaveValue('Untitled question')
  expect(api.callsTo('POST', /\/questions$/)).toHaveLength(1)
  await expect.poll(() => api.questionsOf(form.id).length).toBe(2)
})

test('typing a multi-letter option keeps focus, then adds Other and toggles required', async ({ page, api }) => {
  const form = seedForm(api)
  await page.goto(`/forms/${form.id}/edit`)
  await toolbar(page).getByRole('button', { name: 'Add question', exact: true }).click()

  // The new choice question starts with "Option 1". Replace it letter by letter.
  const option = page.getByRole('textbox', { name: 'Option 1' })
  await option.fill('')
  await option.pressSequentially('Vegetarian thali')
  await expect(option).toHaveValue('Vegetarian thali')
  await expect(option).toBeFocused()

  await page.getByRole('button', { name: 'Add option' }).click()
  const second = page.getByRole('textbox', { name: 'Option 2' })
  await second.fill('')
  await second.pressSequentially('Rice bowl')
  await expect(second).toHaveValue('Rice bowl')
  await expect(second).toBeFocused()

  await page.getByRole('button', { name: 'add "Other"' }).click()
  await expect(page.getByText('Other...')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove "Other" option' })).toBeVisible()

  const required = page.getByRole('switch', { name: 'Required' })
  await expect(required).toHaveAttribute('aria-checked', 'false')
  await required.click()
  await expect(required).toHaveAttribute('aria-checked', 'true')

  // Autosave sends the typed labels, the Other flag and the required flag.
  await expect
    .poll(() => api.callsTo('PATCH', /\/questions\/[^/]+$/).at(-1)?.body)
    .toMatchObject({
      required: true,
      options: [{ label: 'Vegetarian thali' }, { label: 'Rice bowl' }],
      settings: { allowOther: true },
    })
})

test('inserts a new question right after the selected one', async ({ page, api }) => {
  const form = seedForm(api)
  await page.goto(`/forms/${form.id}/edit`)

  await card(page, 'First question').click()
  await toolbar(page).getByRole('button', { name: 'Add question', exact: true }).click()

  await expect(page.locator('article.editor-question').nth(1)).toHaveClass(/active-card/)
  await expect(page.locator('article.editor-question')).toHaveCount(4)
  await expect
    .poll(() => api.questionsOf(form.id).map((q) => q.label))
    .toEqual(['First question', 'Untitled question', 'Second question', 'Third question'])
})

test('clicking outside the open question collapses it', async ({ page, api }) => {
  const form = seedForm(api)
  await page.goto(`/forms/${form.id}/edit`)

  await card(page, 'Second question').click()
  await expect(page.getByRole('textbox', { name: 'Question title' })).toHaveValue('Second question')

  await page.locator('.editor-form-header-title').click()

  await expect(page.getByRole('textbox', { name: 'Question title' })).toHaveCount(0)
  await expect(card(page, 'Second question')).toHaveClass(/inactive-card/)
})

test('the image menu opens on a question that has an image', async ({ page, api }) => {
  const form = api.addForm({ title: 'Image form' }, [
    {
      label: 'Which logo?',
      type: 'SHORT_TEXT',
      required: false,
      imageUrl: PIXEL,
      imageAlign: 'LEFT',
    },
  ])
  await page.goto(`/forms/${form.id}/edit`)
  await card(page, 'Which logo?').click()

  await page.getByRole('button', { name: 'Image menu' }).click()

  const menu = page.getByRole('menu', { name: 'Image menu' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: 'Left align' })).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('menuitem', { name: 'Remove' })).toBeVisible()

  await menu.getByRole('menuitemradio', { name: 'Center align' }).click()
  await expect
    .poll(() => api.callsTo('PATCH', /\/questions\/[^/]+$/).at(-1)?.body)
    .toMatchObject({ imageAlign: 'CENTER' })
})

test('option choices are listed in the editor for a choice question', async ({ page, api }) => {
  const form = api.addForm({ title: 'Choice form' }, [
    { label: 'Pick one', type: 'SINGLE_CHOICE', required: false, options: choiceOptions('Tea', 'Coffee') },
  ])
  await page.goto(`/forms/${form.id}/edit`)
  await card(page, 'Pick one').click()

  await expect(page.getByRole('textbox', { name: 'Option 1' })).toHaveValue('Tea')
  await expect(page.getByRole('textbox', { name: 'Option 2' })).toHaveValue('Coffee')
})
