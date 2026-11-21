import { test, expect } from './helpers/fixtures.ts'
import { addPublishedForm, choiceOptions, WORKSPACE, type MockApi } from './helpers/mockApi.ts'

function snackForm(api: MockApi) {
  return addPublishedForm(api, { title: 'Snack poll', description: 'Tell us what to order.' }, [
    {
      label: 'Favourite snack',
      type: 'SINGLE_CHOICE',
      required: true,
      options: choiceOptions('Pizza', 'Burger', 'Salad'),
      settings: { allowOther: true },
    },
    { label: 'Your name', type: 'SHORT_TEXT', required: false },
  ])
}

test.describe('public form', () => {
  test('hides the workspace name and offers no dark mode, even on a dark OS', async ({ page, api }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => window.localStorage.setItem('qivo-color-scheme', 'dark'))
    const form = snackForm(api)

    await page.goto(`/f/${form.slug}`)

    await expect(page.getByRole('heading', { name: 'Snack poll' })).toBeVisible()
    await expect(page.getByText(WORKSPACE.name)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /dark|theme|appearance/i })).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  })

  test('validates a required question, then submits a radio choice', async ({ page, api }) => {
    const form = snackForm(api)
    await page.goto(`/f/${form.slug}`)

    await page.getByRole('button', { name: 'Submit response' }).click()
    await expect(page.getByRole('alert')).toHaveText('Please answer: Favourite snack')
    expect(api.callsTo('POST', /\/responses$/)).toHaveLength(0)

    await page.getByRole('radio', { name: 'Burger' }).check()
    await expect(page.getByRole('radio', { name: 'Burger' })).toBeChecked()
    await page.getByRole('button', { name: 'Submit response' }).click()

    await expect(page.getByRole('heading', { name: 'Response submitted' })).toBeVisible()
    const [post] = api.callsTo('POST', /\/responses$/)
    expect(JSON.stringify(post?.body?.answers)).toContain('burger')
  })

  test('the Other choice needs text and submits it', async ({ page, api }) => {
    const form = snackForm(api)
    await page.goto(`/f/${form.slug}`)

    await page.getByRole('radio', { name: 'Other:' }).check({ force: true })
    const other = page.getByRole('textbox', { name: 'Other, please specify' })
    await expect(other).toBeEnabled()

    await page.getByRole('button', { name: 'Submit response' }).click()
    await expect(page.getByText('Type your answer for Other.')).toBeVisible()
    expect(api.callsTo('POST', /\/responses$/)).toHaveLength(0)

    await other.fill('Samosa')
    await page.getByRole('button', { name: 'Submit response' }).click()

    await expect(page.getByRole('heading', { name: 'Response submitted' })).toBeVisible()
    const [post] = api.callsTo('POST', /\/responses$/)
    expect(JSON.stringify(post?.body?.answers)).toContain('Samosa')
  })

  test('manual UPI block shows the UPI ID and QR and validates the UTR', async ({ page, api }) => {
    const form = addPublishedForm(
      api,
      {
        title: 'Workshop fee',
        manualUpi: {
          enabled: true,
          upiId: 'asha@okhdfc',
          payeeName: 'Asha Rao',
          amount: 25000,
          requireScreenshot: false,
        },
      },
      [{ label: 'Your name', type: 'SHORT_TEXT', required: false }],
    )
    await page.goto(`/f/${form.slug}`)

    const upi = page.getByRole('region', { name: 'Pay via UPI' })
    await expect(upi.getByText('asha@okhdfc')).toBeVisible()
    await expect(upi.getByText('\u20B9250.00')).toBeVisible()
    await expect(upi.getByRole('img', { name: 'UPI payment QR code for Asha Rao' })).toBeVisible()

    await page.getByRole('button', { name: 'Submit response' }).click()
    await expect(page.getByText('Enter the UTR from your payment app.')).toBeVisible()

    const utr = page.getByLabel(/UTR \/ reference number/)
    await utr.fill('abc')
    await utr.blur()
    await expect(page.getByText(/Enter a valid UTR/)).toBeVisible()
    expect(api.callsTo('POST', /\/responses$/)).toHaveLength(0)

    await utr.fill('utr1234567890')
    await expect(utr).toHaveValue('UTR1234567890')
    await page.getByRole('button', { name: 'Submit response' }).click()

    await expect(page.getByRole('heading', { name: 'Response submitted' })).toBeVisible()
    const [post] = api.callsTo('POST', /\/responses$/)
    expect(JSON.stringify(post?.body)).toContain('UTR1234567890')
  })

  test('shuffled option order stays the same after a reload', async ({ page, api }) => {
    const labels = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel']
    const form = addPublishedForm(api, { title: 'Shuffle form' }, [
      {
        label: 'Pick a letter',
        type: 'SINGLE_CHOICE',
        required: false,
        options: choiceOptions(...labels),
        settings: { shuffleOptions: true },
      },
    ])
    const order = async () => (await page.getByRole('radio').evaluateAll((els) =>
      els.map((el) => (el.closest('label')?.textContent ?? '').trim()),
    ))

    await page.goto(`/f/${form.slug}`)
    await expect(page.getByRole('radio')).toHaveCount(labels.length)
    const first = await order()
    expect([...first].sort()).toEqual([...labels].sort())

    await page.reload()
    await expect(page.getByRole('radio')).toHaveCount(labels.length)
    expect(await order()).toEqual(first)
  })
})
