import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
});

const prismaMock = vi.hoisted(() => ({
  form: { findFirst: vi.fn(), updateMany: vi.fn() },
  formReport: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  user: { findMany: vi.fn() },
  session: { findUnique: vi.fn() },
}));
vi.mock("../../db/prisma.js", () => ({ default: prismaMock }));
const notifyMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../notifications/notification.service.js", () => ({
  notifyFormEvent: notifyMock,
}));

const { createPublicReportRouter, adminReportRouter } = await import("./report.routes.js");
const { hashIp } = await import("./report.service.js");
const { csrfProtection } = await import("../../middleware/csrf.js");
const { ZodError } = await import("zod");

// Mirrors the status mapping of the real app error handler for these cases.
const errorHandlerForTests: express.ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR" } });
  } else if (error?.name === "PUBLIC_FORM_NOT_FOUND") {
    res.status(404).json({ success: false, error: { code: "PUBLIC_FORM_NOT_FOUND" } });
  } else {
    res.status(500).json({ success: false });
  }
};

function makeApp(limit = 5) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(csrfProtection(["http://localhost:5173"]));
  app.use("/api/public", createPublicReportRouter(limit));
  app.use("/api/admin", adminReportRouter);
  app.use(errorHandlerForTests);
  return app;
}

const FORM = { id: "f1", title: "Fest", ownerId: "owner1", flaggedAt: null };
const url = "/api/public/forms/fest/report";

beforeEach(() => {
  vi.resetAllMocks();
  notifyMock.mockImplementation(() => Promise.resolve());
  delete process.env.PLATFORM_ADMIN_EMAILS;
  prismaMock.form.findFirst.mockResolvedValue(FORM);
  prismaMock.formReport.findFirst.mockResolvedValue(null);
  prismaMock.formReport.create.mockResolvedValue({ id: "r1" });
  prismaMock.formReport.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
});

describe("POST /api/public/forms/:slug/report", () => {
  it("records a valid report without auth or Origin header", async () => {
    const res = await request(makeApp()).post(url).send({ reason: "SPAM", details: " junk " });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { received: true } });
    const data = prismaMock.formReport.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ formId: "f1", reason: "SPAM", details: "junk" });
  });

  it("stores a hash of the IP, never the raw IP", async () => {
    await request(makeApp())
      .post(url)
      .set("X-Forwarded-For", "203.0.113.9")
      .set("User-Agent", "x".repeat(400))
      .send({ reason: "SCAM" });
    const data = prismaMock.formReport.create.mock.calls[0]?.[0].data;
    expect(data.ipHash).toBe(hashIp("203.0.113.9"));
    expect(data.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain("203.0.113.9");
    expect(data.userAgent.length).toBe(255);
  });

  it.each([
    ["missing reason", {}],
    ["unknown reason", { reason: "NOPE" }],
    ["details over 500 chars", { reason: "OTHER", details: "a".repeat(501) }],
    ["bad email", { reason: "OTHER", reporterEmail: "not-an-email" }],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await request(makeApp()).post(url).send(body);
    expect(res.status).toBe(400);
    expect(prismaMock.formReport.create).not.toHaveBeenCalled();
  });

  it("accepts an empty email and 500-char details", async () => {
    const res = await request(makeApp())
      .post(url)
      .send({ reason: "OTHER", reporterEmail: "", details: "a".repeat(500) });
    expect(res.status).toBe(201);
    expect(prismaMock.formReport.create.mock.calls[0]?.[0].data.reporterEmail).toBeUndefined();
  });

  it("answers 404 for an unknown or unpublished form", async () => {
    prismaMock.form.findFirst.mockResolvedValue(null);
    const res = await request(makeApp()).post(url).send({ reason: "SPAM" });
    expect(res.status).toBe(404);
  });

  it("silently drops honeypot submissions", async () => {
    const res = await request(makeApp()).post(url).send({ reason: "SPAM", website: "http://bot" });
    expect(res.status).toBe(201);
    expect(prismaMock.form.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.formReport.create).not.toHaveBeenCalled();
  });

  it("dedupes one report per IP per form per day with the same success response", async () => {
    prismaMock.formReport.findFirst.mockResolvedValue({ id: "old" });
    const res = await request(makeApp()).post(url).send({ reason: "SPAM" });
    expect(res.status).toBe(201);
    expect(prismaMock.formReport.create).not.toHaveBeenCalled();
    const where = prismaMock.formReport.findFirst.mock.calls[0]?.[0].where;
    expect(where.formId).toBe("f1");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("rate limits an IP after the hourly cap", async () => {
    const app = makeApp(2);
    expect((await request(app).post(url).send({ reason: "SPAM" })).status).toBe(201);
    expect((await request(app).post(url).send({ reason: "SPAM" })).status).toBe(201);
    const third = await request(app).post(url).send({ reason: "SPAM" });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("auto-flagging", () => {
  const scam = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ipHash: `h${i}` }));

  it("flags the form and notifies owner + platform admins at 3 distinct SCAM reporters", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Boss@Qivo.test";
    prismaMock.formReport.findMany.mockResolvedValue(scam(3));
    prismaMock.form.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findMany.mockResolvedValue([{ id: "admin1" }]);
    const res = await request(makeApp()).post(url).send({ reason: "SCAM" });
    expect(res.status).toBe(201);
    expect(prismaMock.formReport.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { formId: "f1", status: "OPEN", reason: "SCAM" },
      distinct: ["ipHash"],
    });
    expect(prismaMock.form.updateMany.mock.calls[0]?.[0].where).toEqual({ id: "f1", flaggedAt: null });
    expect(prismaMock.user.findMany.mock.calls[0]?.[0].where).toEqual({
      email: { in: ["boss@qivo.test"] },
    });
    const call = notifyMock.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(call[0]).toMatchObject({
      type: "FORM_REPORTED",
      targetUserIds: ["owner1", "admin1"],
    });
  });

  it("does not flag below the threshold", async () => {
    prismaMock.formReport.findMany.mockResolvedValue(scam(2));
    await request(makeApp()).post(url).send({ reason: "SCAM" });
    expect(prismaMock.form.updateMany).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("does not count non-SCAM reasons", async () => {
    await request(makeApp()).post(url).send({ reason: "SPAM" });
    expect(prismaMock.formReport.findMany).not.toHaveBeenCalled();
  });

  it("does not notify again when another request already flagged the form", async () => {
    prismaMock.formReport.findMany.mockResolvedValue(scam(4));
    prismaMock.form.updateMany.mockResolvedValue({ count: 0 });
    await request(makeApp()).post(url).send({ reason: "SCAM" });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("skips the check for an already flagged form", async () => {
    prismaMock.form.findFirst.mockResolvedValue({ ...FORM, flaggedAt: new Date() });
    await request(makeApp()).post(url).send({ reason: "SCAM" });
    expect(prismaMock.formReport.findMany).not.toHaveBeenCalled();
  });

  it("never unpublishes the form", async () => {
    prismaMock.formReport.findMany.mockResolvedValue(scam(3));
    prismaMock.form.updateMany.mockResolvedValue({ count: 1 });
    await request(makeApp()).post(url).send({ reason: "SCAM" });
    expect(prismaMock.form.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty("status");
  });
});

describe("admin report endpoints", () => {
  function session(email: string) {
    prismaMock.session.findUnique.mockResolvedValue({
      id: "s1",
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "u1", name: "U", email },
    });
  }

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(makeApp()).get("/api/admin/reports");
    expect(res.status).toBe(401);
  });

  it("rejects signed-in non-admins with 403 (fails closed when unset)", async () => {
    session("user@example.com");
    const res = await request(makeApp()).get("/api/admin/reports").set("Authorization", "Bearer t");
    expect(res.status).toBe(403);
    const patch = await request(makeApp())
      .patch("/api/admin/reports/r1")
      .set("Authorization", "Bearer t")
      .send({ status: "REVIEWED" });
    expect(patch.status).toBe(403);
    expect(prismaMock.formReport.update).not.toHaveBeenCalled();
  });

  it("lists reports with form details and per-form counts for an admin", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "boss@qivo.test";
    session("Boss@qivo.test");
    prismaMock.formReport.count.mockResolvedValue(1);
    prismaMock.formReport.findMany.mockResolvedValue([
      {
        id: "r1",
        reason: "SCAM",
        details: null,
        reporterEmail: null,
        status: "OPEN",
        createdAt: new Date("2026-11-22T00:00:00Z"),
        reviewedAt: null,
        form: {
          id: "f1",
          title: "Fest",
          slug: "fest",
          status: "PUBLISHED",
          flaggedAt: null,
          owner: { email: "owner@example.com" },
        },
      },
    ]);
    prismaMock.formReport.groupBy.mockResolvedValue([{ formId: "f1", _count: { _all: 4 } }]);
    const res = await request(makeApp())
      .get("/api/admin/reports?status=OPEN&page=1&pageSize=10")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
    expect(prismaMock.formReport.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { status: "OPEN" },
      skip: 0,
      take: 10,
    });
    expect(res.body.data).toMatchObject({
      total: 1,
      reports: [{ id: "r1", reportCount: 4, form: { title: "Fest", ownerEmail: "owner@example.com" } }],
    });
    expect(JSON.stringify(res.body)).not.toContain("ipHash");
  });

  it("rejects an invalid status filter", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "boss@qivo.test";
    session("boss@qivo.test");
    const res = await request(makeApp()).get("/api/admin/reports?status=BAD").set("Authorization", "Bearer t");
    expect(res.status).toBe(400);
  });

  it("updates a report status and records the reviewer", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "boss@qivo.test";
    session("boss@qivo.test");
    prismaMock.formReport.findUnique.mockResolvedValue({ id: "r1" });
    prismaMock.formReport.update.mockResolvedValue({ id: "r1", status: "DISMISSED", reviewedAt: new Date() });
    const res = await request(makeApp())
      .patch("/api/admin/reports/r1")
      .set("Authorization", "Bearer t")
      .send({ status: "DISMISSED" });
    expect(res.status).toBe(200);
    expect(prismaMock.formReport.update.mock.calls[0]?.[0].data).toMatchObject({
      status: "DISMISSED",
      reviewedById: "u1",
    });
  });

  it("returns 404 for an unknown report", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "boss@qivo.test";
    session("boss@qivo.test");
    prismaMock.formReport.findUnique.mockResolvedValue(null);
    const res = await request(makeApp())
      .patch("/api/admin/reports/nope")
      .set("Authorization", "Bearer t")
      .send({ status: "REVIEWED" });
    expect(res.status).toBe(404);
  });
});