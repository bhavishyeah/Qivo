// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api };
});

import AdminReports, { type AdminReport } from "./AdminReports";
import { ApiRequestError } from "../lib/api";

const report: AdminReport = {
  id: "r1",
  reason: "SCAM",
  details: "UPI ID is not the organiser's",
  reporterEmail: null,
  status: "OPEN",
  createdAt: "2026-11-22T10:00:00.000Z",
  reportCount: 3,
  form: {
    id: "f1",
    title: "Campus Fest",
    slug: "campus-fest",
    status: "PUBLISHED",
    flaggedAt: "2026-11-22T10:00:00.000Z",
    ownerEmail: "owner@example.com",
  },
};

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue({ reports: [report], total: 1, page: 1, pageSize: 20 });
  api.patch.mockResolvedValue({});
});
afterEach(cleanup);

describe("AdminReports", () => {
  it("renders the reports table with form, reason, count, latest and status", async () => {
    render(<AdminReports />);
    const table = await screen.findByRole("table");
    expect(api.get).toHaveBeenCalledWith("/api/admin/reports?status=OPEN&page=1&pageSize=20");
    for (const name of ["Form", "Reason", "Reports", "Latest", "Status", "Actions"]) {
      expect(within(table).getByRole("columnheader", { name })).toBeTruthy();
    }
    expect(within(table).getByText("Campus Fest")).toBeTruthy();
    expect(within(table).getByText("Looks like a scam or wrong UPI ID")).toBeTruthy();
    expect(within(table).getByText("3")).toBeTruthy();
    expect(within(table).getByText("Open")).toBeTruthy();
    const link = within(table).getByRole("link", { name: "Open form" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/f/campus-fest");
  });

  it("marks a report reviewed and reloads", async () => {
    const user = userEvent.setup();
    render(<AdminReports />);
    await user.click(await screen.findByRole("button", { name: "Mark reviewed" }));
    expect(api.patch).toHaveBeenCalledWith("/api/admin/reports/r1", { status: "REVIEWED" });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it("dismisses a report", async () => {
    const user = userEvent.setup();
    render(<AdminReports />);
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(api.patch).toHaveBeenCalledWith("/api/admin/reports/r1", { status: "DISMISSED" });
  });

  it("switches the status filter", async () => {
    const user = userEvent.setup();
    render(<AdminReports />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Dismissed" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith("/api/admin/reports?status=DISMISSED&page=1&pageSize=20"),
    );
  });

  it("renders nothing for accounts that are not platform admins", async () => {
    api.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "no"));
    const { container } = render(<AdminReports />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("hides the moderation chrome until the first access check resolves", async () => {
    // In-flight access check that never settles: the Reports heading and filter
    // buttons must not render at all, or non-admins would see them briefly.
    api.get.mockImplementation(() => new Promise(() => {}));
    render(<AdminReports />);
    expect(screen.queryByRole("heading", { name: "Reports" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Report status" })).toBeNull();
    expect(screen.queryByText("Loading reports...")).toBeNull();
  });
});