// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const publicPost = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, publicPost };
});

import ReportFormLink from "./ReportFormLink";
import { validateReport } from "../lib/reportForm";

beforeEach(() => {
  publicPost.mockReset();
  publicPost.mockResolvedValue({ received: true });
});
afterEach(cleanup);

async function openDialog() {
  const user = userEvent.setup();
  render(<ReportFormLink slug="fest" />);
  await user.click(screen.getByRole("button", { name: "Report this form" }));
  return user;
}

describe("validateReport", () => {
  it("requires a reason and checks email shape and details length", () => {
    expect(validateReport({ reason: "", details: "", email: "" }).reason).toBeTruthy();
    expect(validateReport({ reason: "SPAM", details: "", email: "" })).toEqual({});
    expect(validateReport({ reason: "SPAM", details: "", email: "nope" }).email).toBeTruthy();
    expect(validateReport({ reason: "SPAM", details: "a".repeat(501), email: "" }).details).toBeTruthy();
  });
});

describe("ReportFormLink", () => {
  it("renders nothing without a slug", () => {
    const { container } = render(<ReportFormLink slug={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("opens a dialog with the four reasons", async () => {
    await openDialog();
    expect(screen.getByRole("dialog", { name: "Report this form" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "Looks like a scam or wrong UPI ID" })).toBeTruthy();
  });

  it("blocks submit without a reason and shows an error", async () => {
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Choose a reason");
    expect(publicPost).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const user = await openDialog();
    await user.click(screen.getByRole("radio", { name: "Other" }));
    await user.type(screen.getByLabelText("Your email (optional)"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect((await screen.findByRole("alert")).textContent).toContain("valid email");
    expect(publicPost).not.toHaveBeenCalled();
  });

  it("caps details at 500 characters", async () => {
    const user = await openDialog();
    const box = screen.getByLabelText("Details (optional)") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(500);
    await user.click(box);
    await user.paste("a".repeat(600));
    expect(box.value.length).toBe(500);
  });

  it("submits and shows the success message", async () => {
    const user = await openDialog();
    await user.click(screen.getByRole("radio", { name: "Looks like a scam or wrong UPI ID" }));
    await user.type(screen.getByLabelText("Details (optional)"), "wrong payee");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Thanks, we will review this form."));
    expect(publicPost).toHaveBeenCalledWith("/api/public/forms/fest/report", {
      reason: "SCAM",
      details: "wrong payee",
      reporterEmail: undefined,
      website: "",
    });
  });

  it("shows the server error and stays on the form", async () => {
    const { ApiRequestError } = await import("../lib/api");
    publicPost.mockRejectedValue(new ApiRequestError("RATE_LIMITED", "Too many reports from your network."));
    const user = await openDialog();
    await user.click(screen.getByRole("radio", { name: "Spam or offensive" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Too many reports");
  });
});