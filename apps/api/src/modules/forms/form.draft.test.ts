import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB so no real DB call can happen. The draft path only touches the
// `form` and `formDraft` delegates; `payment` is included so we can assert the
// save-draft path NEVER creates a payment order/row.
const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn() },
  formDraft: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  payment: { create: vi.fn() },
}));

vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));

const {
  saveDraft,
  loadDraft,
  deleteDraftByToken,
  deleteExpiredDrafts,
} = await import("./form.service.js");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function formRow(opts: { allowPartialSave?: boolean } = {}) {
  return {
    id: "form_1",
    slug: "my-form",
    schema: {
      version: 1,
      sections: [
        {
          id: "s1",
          title: "S",
          questions: [{ id: "q_name", label: "Name", type: "SHORT_TEXT" }],
        },
      ],
      settings: {
        collectEmail: true,
        allowMultipleResponses: true,
        allowPartialSave: opts.allowPartialSave ?? true,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveDraft — create", () => {
  it("creates a new draft when no token is supplied and returns token + ~30d expiry", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "draft_1",
    }));

    const before = Date.now();
    const result = await saveDraft("my-form", {
      answers: { q_name: "Asha" },
      email: "a@example.com",
      currentSection: 0,
    });
    const after = Date.now();

    expect(prismaMock.formDraft.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.formDraft.findUnique).not.toHaveBeenCalled();
    // A high-entropy base64url token (32 bytes → ~43 chars).
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const expiry = result.expiresAt.getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - 5_000);
    expect(expiry).toBeLessThanOrEqual(after + THIRTY_DAYS_MS + 5_000);
    // Never charges / creates a payment on save.
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it("creates a new draft when the supplied token is unknown", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue(null);
    prismaMock.formDraft.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "draft_1",
    }));

    const result = await saveDraft("my-form", {
      answers: { q_name: "Asha" },
      token: "stale-unknown-token",
    });

    expect(prismaMock.formDraft.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.formDraft.update).not.toHaveBeenCalled();
    expect(result.token).not.toBe("stale-unknown-token");
  });

  it("creates a new draft when the supplied token belongs to a different form", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue({
      token: "t",
      formId: "other_form",
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    });
    prismaMock.formDraft.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "draft_1",
    }));

    await saveDraft("my-form", { answers: {}, token: "t" });
    expect(prismaMock.formDraft.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.formDraft.update).not.toHaveBeenCalled();
  });
});

describe("saveDraft — update", () => {
  it("updates an existing valid draft for this form and extends expiry", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue({
      token: "valid-token",
      formId: "form_1",
      expiresAt: new Date(Date.now() + 1_000),
    });
    prismaMock.formDraft.update.mockImplementation(async ({ data }) => ({
      token: "valid-token",
      expiresAt: data.expiresAt,
    }));

    const before = Date.now();
    const result = await saveDraft("my-form", {
      answers: { q_name: "Updated" },
      email: "b@example.com",
      currentSection: 1,
      token: "valid-token",
    });

    expect(prismaMock.formDraft.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.formDraft.create).not.toHaveBeenCalled();
    expect(result.token).toBe("valid-token");
    // Expiry extended well into the future (not the near-past 1s window).
    expect(result.expiresAt.getTime()).toBeGreaterThan(before + THIRTY_DAYS_MS - 5_000);
  });

  it("prunes an expired token then creates a fresh draft", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue({
      token: "expired-token",
      formId: "form_1",
      expiresAt: new Date(Date.now() - 1_000),
    });
    prismaMock.formDraft.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.formDraft.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: "draft_2",
    }));

    const result = await saveDraft("my-form", {
      answers: {},
      token: "expired-token",
    });

    expect(prismaMock.formDraft.deleteMany).toHaveBeenCalledWith({
      where: { token: "expired-token" },
    });
    expect(prismaMock.formDraft.update).not.toHaveBeenCalled();
    expect(prismaMock.formDraft.create).toHaveBeenCalledTimes(1);
    expect(result.token).not.toBe("expired-token");
  });
});

describe("saveDraft — gating", () => {
  it("throws PUBLIC_FORM_NOT_FOUND when the form is not published/found", async () => {
    prismaMock.form.findFirst.mockResolvedValue(null);
    await expect(
      saveDraft("my-form", { answers: {} }),
    ).rejects.toMatchObject({ name: "PUBLIC_FORM_NOT_FOUND" });
    expect(prismaMock.formDraft.create).not.toHaveBeenCalled();
  });

  it("throws PARTIAL_SAVE_DISABLED when the feature is off", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ allowPartialSave: false }),
    );
    await expect(
      saveDraft("my-form", { answers: {} }),
    ).rejects.toMatchObject({ name: "PARTIAL_SAVE_DISABLED" });
    expect(prismaMock.formDraft.create).not.toHaveBeenCalled();
  });
});

describe("loadDraft", () => {
  it("returns answers/email/currentSection for a valid unexpired draft", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue({
      token: "valid-token",
      formId: "form_1",
      answers: { q_name: "Asha" },
      email: "a@example.com",
      currentSection: 2,
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    });

    const result = await loadDraft("my-form", "valid-token");
    expect(result).toEqual({
      answers: { q_name: "Asha" },
      email: "a@example.com",
      currentSection: 2,
    });
    expect(prismaMock.formDraft.deleteMany).not.toHaveBeenCalled();
  });

  it("throws DRAFT_NOT_FOUND for an unknown token", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue(null);
    await expect(loadDraft("my-form", "nope")).rejects.toMatchObject({
      name: "DRAFT_NOT_FOUND",
    });
  });

  it("throws DRAFT_NOT_FOUND for a token belonging to another form", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue({
      token: "t",
      formId: "other_form",
      answers: {},
      email: null,
      currentSection: null,
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    });
    await expect(loadDraft("my-form", "t")).rejects.toMatchObject({
      name: "DRAFT_NOT_FOUND",
    });
  });

  it("deletes an expired draft on read and throws DRAFT_NOT_FOUND", async () => {
    prismaMock.form.findFirst.mockResolvedValue(formRow());
    prismaMock.formDraft.findUnique.mockResolvedValue({
      token: "expired",
      formId: "form_1",
      answers: {},
      email: null,
      currentSection: null,
      expiresAt: new Date(Date.now() - 1_000),
    });
    prismaMock.formDraft.deleteMany.mockResolvedValue({ count: 1 });

    await expect(loadDraft("my-form", "expired")).rejects.toMatchObject({
      name: "DRAFT_NOT_FOUND",
    });
    expect(prismaMock.formDraft.deleteMany).toHaveBeenCalledWith({
      where: { token: "expired" },
    });
  });

  it("throws PARTIAL_SAVE_DISABLED when the feature is off", async () => {
    prismaMock.form.findFirst.mockResolvedValue(
      formRow({ allowPartialSave: false }),
    );
    await expect(loadDraft("my-form", "t")).rejects.toMatchObject({
      name: "PARTIAL_SAVE_DISABLED",
    });
  });
});

describe("deleteDraftByToken", () => {
  it("deletes by token scoped to the form (no-op on a missing row)", async () => {
    prismaMock.form.findFirst.mockResolvedValue({ id: "form_1" });
    prismaMock.formDraft.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      deleteDraftByToken("my-form", "some-token"),
    ).resolves.toBeUndefined();
    expect(prismaMock.formDraft.deleteMany).toHaveBeenCalledWith({
      where: { token: "some-token", formId: "form_1" },
    });
  });

  it("throws PUBLIC_FORM_NOT_FOUND when the form is gone", async () => {
    prismaMock.form.findFirst.mockResolvedValue(null);
    await expect(
      deleteDraftByToken("my-form", "t"),
    ).rejects.toMatchObject({ name: "PUBLIC_FORM_NOT_FOUND" });
    expect(prismaMock.formDraft.deleteMany).not.toHaveBeenCalled();
  });
});

describe("deleteExpiredDrafts", () => {
  it("removes rows with expiresAt <= now and returns the count", async () => {
    prismaMock.formDraft.deleteMany.mockResolvedValue({ count: 3 });
    const count = await deleteExpiredDrafts();
    expect(count).toBe(3);
    const call = prismaMock.formDraft.deleteMany.mock.calls[0]![0];
    expect(call.where.expiresAt.lte).toBeInstanceOf(Date);
  });
});
