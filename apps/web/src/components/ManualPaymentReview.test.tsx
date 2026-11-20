// Must be first: installs the localStorage stub that lib/api.ts reads at import time.
import "../pages/__a11yStub";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ManualPaymentBadge,
  ManualPaymentCell,
  ManualPaymentSummaryBar,
} from "./ManualPaymentReview";
import type { ManualPaymentRecord } from "../types";

const base: ManualPaymentRecord = {
  utr: "AB12CD34EF56",
  status: "pending",
  submittedAt: "2025-01-01T00:00:00.000Z",
  proofUrl: "https://res.cloudinary.com/demo/image/upload/v1/proof.jpg",
};

describe("ManualPaymentBadge", () => {
  it.each([
    ["pending", "Pending"],
    ["verified", "Verified"],
    ["rejected", "Rejected"],
  ] as const)("shows text for %s", (status, text) => {
    expect(renderToStaticMarkup(<ManualPaymentBadge status={status} />)).toContain(text);
  });
});

describe("ManualPaymentCell", () => {
  it("renders UTR, thumbnail link with rel and a duplicate warning", () => {
    const html = renderToStaticMarkup(
      <ManualPaymentCell payment={base} duplicate onStatusChange={() => {}} />,
    );
    expect(html).toContain("AB12CD34EF56");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("<img");
    expect(html).toContain("more than one response");
  });

  it("omits the duplicate warning when not flagged", () => {
    const html = renderToStaticMarkup(
      <ManualPaymentCell payment={base} onStatusChange={() => {}} />,
    );
    expect(html).not.toContain("more than one response");
  });

  it("renders no img or link for a non-https proof", () => {
    const html = renderToStaticMarkup(
      <ManualPaymentCell
        payment={{ ...base, proofUrl: "javascript:alert(1)" }}
        onStatusChange={() => {}}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("disables all controls while a request is in flight", () => {
    const html = renderToStaticMarkup(
      <ManualPaymentCell payment={base} busy onStatusChange={() => {}} />,
    );
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b).toContain("disabled");
  });

  it("disables the control matching the current status only", () => {
    const html = renderToStaticMarkup(
      <ManualPaymentCell payment={{ ...base, status: "verified" }} onStatusChange={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Verify/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Reject/);
  });

  it("escapes a hostile UTR", () => {
    const html = renderToStaticMarkup(
      <ManualPaymentCell
        payment={{ ...base, utr: "<script>x</script>" }}
        onStatusChange={() => {}}
      />,
    );
    expect(html).not.toContain("<script>");
  });
});

describe("ManualPaymentSummaryBar", () => {
  it("shows the summary string and duplicate count", () => {
    const html = renderToStaticMarkup(
      <ManualPaymentSummaryBar
        counts={{ verified: 12, pending: 3, rejected: 1 }}
        duplicateCount={2}
        filter=""
        onFilterChange={() => {}}
      />,
    );
    expect(html).toContain("12 verified · 3 pending · 1 rejected");
    expect(html).toContain("2 duplicate UTRs");
    expect(html).toContain('aria-haspopup="listbox"');
  });
});
