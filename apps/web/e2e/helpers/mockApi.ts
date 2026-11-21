import type { Page, Route } from '@playwright/test'

/**
 * In-memory fake of the Qivo API for the smoke suite. Every response uses the
 * real envelope: { success: true, data } or { success: false, error }.
 * Install it per test with `await installMockApi(page)`.
 */

export const TEST_USER = { id: 'user-1', name: 'Asha Rao', email: 'asha@example.com' }
export const TEST_PASSWORD = 'password123'
export const TEST_TOKEN = 'e2e-token'
export const WORKSPACE = {
  id: 'ws-1',
  name: 'Acme Workspace',
  slug: 'acme',
  type: 'PERSONAL',
  role: 'OWNER',
  createdAt: '2026-01-01T00:00:00.000Z',
}

type Json = Record<string, unknown>

export type MockQuestion = {
  id: string
  label: string
  type: string
  required: boolean
  sectionId: string
  options?: { value: string; label: string }[]
  settings?: Json
  description?: string | null
  [key: string]: unknown
}

export type MockForm = {
  id: string
  workspaceId: string
  title: string
  description: string | null
  slug: string
  status: 'DRAFT' | 'PUBLISHED'
  createdAt: string
  updatedAt: string
  settings: Json
  confirmationMessage?: string
  paymentsAllowed: boolean
  manualUpi?: Json
}

export type MockCall = { method: string; path: string; query: URLSearchParams; body: Json | null }

const SECTION_ID = 'section_main'

const TEMPLATES = [
  {
    id: 'tpl-feedback',
    name: 'Event feedback',
    description: 'Collect feedback after an event.',
    category: 'Events',
    questionCount: 2,
    custom: false,
  },
]

function defaultSettings(): Json {
  return { collectEmail: false, allowMultipleResponses: true }
}

export class MockApi {
  forms: MockForm[] = []
  questions = new Map<string, MockQuestion[]>()
  responses = new Map<string, Json[]>()
  reports: Json[] = []
  /** Every API request that reached the mock, in order. */
  calls: MockCall[] = []
  /** Requests no handler knew about; the suite asserts this stays empty. */
  unhandled: string[] = []
  private counter = 0

  nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}-${this.counter}`
  }

  addForm(input: Partial<MockForm> & { title: string }, questions: Omit<MockQuestion, 'id' | 'sectionId'>[] = []): MockForm {
    const id = input.id ?? this.nextId('form')
    const now = '2026-02-01T10:00:00.000Z'
    const form: MockForm = {
      id,
      workspaceId: WORKSPACE.id,
      description: null,
      slug: `slug-${id}`,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
      settings: defaultSettings(),
      paymentsAllowed: false,
      ...input,
    }
    this.forms.push(form)
    this.questions.set(
      id,
      questions.map((q): MockQuestion => ({ ...q, id: this.nextId('q'), sectionId: SECTION_ID }) as MockQuestion),
    )
    return form
  }

  form(id: string): MockForm {
    const found = this.forms.find((f) => f.id === id)
    if (!found) throw new Error(`mock form ${id} not found`)
    return found
  }

  questionsOf(formId: string): MockQuestion[] {
    return this.questions.get(formId) ?? []
  }

  callsTo(method: string, pathPattern: RegExp): MockCall[] {
    return this.calls.filter((c) => c.method === method && pathPattern.test(c.path))
  }

  /** The form as the owner API returns it (schema built from the flat question list). */
  private schemaFor(form: MockForm) {
    return {
      version: 1,
      sections: [{ id: SECTION_ID, title: 'Section 1', questions: this.questionsOf(form.id) }],
      settings: form.settings,
      ...(form.confirmationMessage ? { confirmationMessage: form.confirmationMessage } : {}),
    }
  }

  ownerForm(form: MockForm) {
    return {
      id: form.id,
      workspaceId: form.workspaceId,
      title: form.title,
      description: form.description,
      slug: form.slug,
      status: form.status,
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
      paymentsAllowed: form.paymentsAllowed,
      schema: this.schemaFor(form),
    }
  }

  publicForm(form: MockForm) {
    return {
      id: form.id,
      slug: form.slug,
      title: form.title,
      description: form.description,
      branding: { workspaceName: WORKSPACE.name },
      capacity: { enabled: false },
      ...(form.manualUpi ? { manualUpi: form.manualUpi } : {}),
      schema: this.schemaFor(form),
    }
  }

  // ---------------------------------------------------------------------------

  async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname

    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    }
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }

    let body: Json | null = null
    const raw = request.postData()
    if (raw) {
      try {
        body = JSON.parse(raw) as Json
      } catch {
        body = null
      }
    }
    this.calls.push({ method, path, query: url.searchParams, body })

    const authed = request.headers()['authorization'] === `Bearer ${TEST_TOKEN}`
    const ok = (data: unknown, status = 200) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
    const fail = (status: number, code: string, message: string) =>
      route.fulfill({
        status,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code, message } }),
      })

    // ---- auth -----------------------------------------------------------
    if (method === 'POST' && path === '/api/auth/login') {
      if (body?.email === TEST_USER.email && body?.password === TEST_PASSWORD) {
        return ok({ token: TEST_TOKEN, user: TEST_USER })
      }
      return fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.')
    }
    if (method === 'POST' && path === '/api/auth/signup') {
      if (body?.email === 'taken@example.com') {
        return fail(409, 'EMAIL_TAKEN', 'An account with this email already exists.')
      }
      return ok({ token: TEST_TOKEN, user: { ...TEST_USER, name: String(body?.name ?? TEST_USER.name) } }, 201)
    }
    if (method === 'GET' && path === '/api/auth/me') {
      return authed ? ok({ user: TEST_USER }) : fail(401, 'UNAUTHORIZED', 'Not signed in.')
    }
    if (method === 'POST' && path === '/api/auth/logout') return ok({})

    // ---- public (no auth) -------------------------------------------------
    let m = path.match(/^\/api\/forms\/public\/([^/]+)$/)
    if (m && method === 'GET') {
      const form = this.forms.find((f) => f.slug === m![1] && f.status === 'PUBLISHED')
      return form ? ok({ form: this.publicForm(form) }) : fail(404, 'FORM_NOT_FOUND', 'This form was not found.')
    }
    m = path.match(/^\/api\/forms\/public\/([^/]+)\/track$/)
    if (m && method === 'POST') return ok({})
    m = path.match(/^\/api\/forms\/public\/([^/]+)\/responses$/)
    if (m && method === 'POST') {
      const form = this.forms.find((f) => f.slug === m![1])
      if (!form) return fail(404, 'FORM_NOT_FOUND', 'This form was not found.')
      const response = { id: this.nextId('resp'), submittedAt: new Date().toISOString() }
      const list = this.responses.get(form.id) ?? []
      list.push({ ...response, answers: body?.answers ?? {}, metadata: body?.metadata ?? null })
      this.responses.set(form.id, list)
      return ok({ response }, 201)
    }
    m = path.match(/^\/api\/public\/forms\/([^/]+)\/report$/)
    if (m && method === 'POST') {
      this.reports.push({ slug: m[1], ...(body ?? {}) })
      return ok({}, 201)
    }

    // ---- everything below needs a session ----------------------------------
    if (!authed) return fail(401, 'UNAUTHORIZED', 'Not signed in.')

    if (method === 'GET' && path === '/api/workspaces') return ok({ workspaces: [WORKSPACE] })
    if (method === 'GET' && path === '/api/folders') return ok({ folders: [] })
    if (method === 'GET' && path === '/api/events') return ok({ events: [] })
    if (method === 'GET' && path === '/api/notifications/unread-count') return ok({ count: 0 })
    if (method === 'GET' && path === '/api/forms/templates') return ok({ templates: TEMPLATES })

    if (method === 'GET' && path === '/api/forms') {
      const forms = this.forms.map((f) => ({
        ...this.ownerForm(f),
        responseCount: (this.responses.get(f.id) ?? []).length,
      }))
      return ok({ forms })
    }
    if (method === 'POST' && (path === '/api/forms' || path === '/api/forms/from-template')) {
      const fromTemplate = path.endsWith('from-template')
      const form = this.addForm(
        { title: String(body?.title ?? 'Untitled'), description: (body?.description as string | undefined) ?? null },
        fromTemplate
          ? [
              { label: 'How was the event?', type: 'RATING', required: true, settings: { min: 1, max: 5 } },
              { label: 'Any other comments?', type: 'LONG_TEXT', required: false },
            ]
          : [],
      )
      return ok({ form: this.ownerForm(form) }, 201)
    }

    m = path.match(/^\/api\/forms\/([^/]+)$/)
    if (m) {
      const form = this.forms.find((f) => f.id === m![1])
      if (!form) return fail(404, 'FORM_NOT_FOUND', 'Form not found.')
      if (method === 'GET') return ok({ form: this.ownerForm(form) })
      if (method === 'PATCH') {
        if (typeof body?.title === 'string') form.title = body.title
        if ('description' in (body ?? {})) form.description = (body?.description as string | null) ?? null
        return ok({ form: this.ownerForm(form) })
      }
    }

    m = path.match(/^\/api\/forms\/([^/]+)\/settings$/)
    if (m && method === 'PATCH') {
      const form = this.form(m[1]!)
      const { confirmationMessage, manualUpi, payment, ...rest } = body ?? {}
      void payment
      form.settings = { ...form.settings, ...rest }
      if (typeof confirmationMessage === 'string') form.confirmationMessage = confirmationMessage
      if (manualUpi) form.settings.manualUpi = manualUpi
      return ok({ form: this.ownerForm(form) })
    }
    m = path.match(/^\/api\/forms\/([^/]+)\/publish$/)
    if (m && method === 'POST') {
      this.form(m[1]!).status = 'PUBLISHED'
      return ok({})
    }
    m = path.match(/^\/api\/forms\/([^/]+)\/responses-count$/)
    if (m && method === 'GET') return ok({ count: (this.responses.get(m[1]!) ?? []).length })
    m = path.match(/^\/api\/forms\/([^/]+)\/responses$/)
    if (m && method === 'GET') {
      const list = this.responses.get(m[1]!) ?? []
      return ok({ responses: list, total: list.length })
    }
    m = path.match(/^\/api\/forms\/([^/]+)\/versions$/)
    if (m && method === 'GET') return ok({ versions: [] })
    m = path.match(/^\/api\/forms\/([^/]+)\/shares$/)
    if (m && method === 'GET') return ok({ shares: [] })
    m = path.match(/^\/api\/forms\/([^/]+)\/webhooks$/)
    if (m && method === 'GET') return ok({ webhooks: [] })

    // ---- questions ---------------------------------------------------------
    m = path.match(/^\/api\/forms\/([^/]+)\/questions$/)
    if (m) {
      const formId = m[1]!
      if (method === 'GET') return ok({ questions: this.questionsOf(formId) })
      if (method === 'POST') {
        const question: MockQuestion = {
          id: this.nextId('q'),
          label: String(body?.label ?? ''),
          type: String(body?.type ?? 'SHORT_TEXT'),
          required: body?.required === true,
          sectionId: SECTION_ID,
          ...(body?.options ? { options: body.options as MockQuestion['options'] } : {}),
          ...(body?.settings ? { settings: body.settings as Json } : {}),
        }
        this.questions.set(formId, [...this.questionsOf(formId), question])
        return ok({ question }, 201)
      }
    }
    m = path.match(/^\/api\/forms\/([^/]+)\/questions\/reorder$/)
    if (m && method === 'POST') {
      const formId = m[1]!
      const order = (body?.questionIds as string[] | undefined) ?? []
      const byId = new Map(this.questionsOf(formId).map((q) => [q.id, q]))
      this.questions.set(formId, order.map((id) => byId.get(id)).filter((q): q is MockQuestion => Boolean(q)))
      return ok({})
    }
    m = path.match(/^\/api\/forms\/([^/]+)\/questions\/([^/]+)$/)
    if (m) {
      const [, formId, questionId] = m as unknown as [string, string, string]
      const list = this.questionsOf(formId)
      const index = list.findIndex((q) => q.id === questionId)
      if (index < 0) return fail(404, 'QUESTION_NOT_FOUND', 'Question not found.')
      if (method === 'PATCH') {
        const patch = { ...(body ?? {}) }
        for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key]
        list[index] = { ...list[index]!, ...patch } as MockQuestion
        return ok({ question: list[index] })
      }
      if (method === 'DELETE') {
        this.questions.set(formId, list.filter((q) => q.id !== questionId))
        return ok({})
      }
    }

    this.unhandled.push(`${method} ${path}`)
    return fail(404, 'NOT_MOCKED', `No mock for ${method} ${path}`)
  }
}

/** Intercepts every API call (fetch/XHR to a /api/ path) on the page. */
export async function installMockApi(page: Page): Promise<MockApi> {
  const api = new MockApi()
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const type = route.request().resourceType()
      if (type !== 'fetch' && type !== 'xhr') return route.continue()
      return api.handle(route)
    },
  )
  return api
}

/** Marks the browser as logged in before the app boots. */
export async function loginAs(page: Page): Promise<void> {
  await page.addInitScript((token) => {
    window.localStorage.setItem('qivo_token', token)
  }, TEST_TOKEN)
}

export function choiceOptions(...labels: string[]): { value: string; label: string }[] {
  return labels.map((label) => ({ value: label.toLowerCase().replace(/\s+/g, '_'), label }))
}

/** Seeds a published form with the given questions, ready for the public page. */
export function addPublishedForm(
  api: MockApi,
  input: Partial<MockForm> & { title: string },
  questions: Omit<MockQuestion, 'id' | 'sectionId'>[],
): MockForm {
  return api.addForm({ status: 'PUBLISHED', ...input }, questions)
}
