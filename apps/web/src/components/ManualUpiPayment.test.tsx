// Must be first: installs the localStorage stub that lib/api.ts reads at import time.
import "../pages/__a11yStub";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ManualUpiPayment from "./ManualUpiPayment";

const config = {
  enabled: true,
  upiId: "asha@ybl",
  payeeName: "Asha K",
  amount: 5000,
  instructions: "Pay the fee",
  requireScreenshot: true,
};

function render(over: Partial<React.ComponentProps<typeof ManualUpiPayment>> = {}) {
  return renderToStaticMarkup(
    <ManualUpiPayment
      config={config}
      formTitle="Fest"
      slug="fest"
      value={{ utr: "", proofUrl: "" }}
      onChange={() => {}}
      errors={{}}
      {...over}
    />,
  );
}

describe("ManualUpiPayment", () => {
  it("renders the QR svg and the exact upi:// link", () => {
    const html = render();
    expect(html).toContain("<svg");
    expect(html).toContain(
      'href="upi://pay?pa=asha%40ybl&amp;pn=Asha%20K&amp;cu=INR&amp;am=50.00&amp;tn=Fest"',
    );
  });

  it("has a copy button, a live status region, and a labelled QR", () => {
    const html = render();
    expect(html).toContain(">Copy<");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-describedby="manual-upi-qr-desc"');
    expect(html).toContain('id="manual-upi-qr-desc"');
    expect(html).toContain("UPI payment QR code for Asha K");
  });

  it("shows the manual-payment label, mismatch warning and honest helper text", () => {
    const html = render();
    expect(html).toContain("doesn&#x27;t process or confirm this payment");
    expect(html).toContain("Check that the payee name shown in your UPI app matches");
    expect(html).toContain("If your UPI app declines the link");
  });

  it("marks the UTR input required with descriptions", () => {
    const html = render();
    expect(html).toContain('id="manual-upi-utr"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-describedby="manual-upi-utr-help"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("flags a UTR error with aria-invalid and role=alert", () => {
    const html = render({ errors: { utr: "Enter the UTR from your payment app." } });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="manual-upi-utr-help manual-upi-utr-error"');
    expect(html).toContain('id="manual-upi-utr-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Enter the UTR from your payment app.");
  });

  it("renders an image-only file input, and a proof error", () => {
    const html = render({ errors: { proof: "Upload a screenshot of your payment." } });
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('id="manual-upi-proof"');
    expect(html).toContain("Upload a screenshot of your payment.");
  });

  it("disables the file input in preview", () => {
    const html = render({ preview: true, slug: null });
    expect(html).toMatch(/<input[^>]*id="manual-upi-proof"[^>]*disabled/);
    expect(html).toContain("Uploads are disabled in preview.");
  });

  it("marks the screenshot optional when not required", () => {
    const html = render({ config: { ...config, requireScreenshot: false } });
    expect(html).toContain("(optional)");
    expect(html).not.toContain('aria-required="true" aria-invalid');
  });

  it("shows a thumbnail with Replace/Remove once uploaded", () => {
    const html = render({ value: { utr: "AB12CD34", proofUrl: "https://res.cloudinary.com/x/image/upload/a.jpg" } });
    expect(html).toContain('alt="Payment screenshot preview"');
    expect(html).toContain("Replace");
    expect(html).toContain("Remove");
  });

  it("escapes hostile payee name and instructions", () => {
    const html = render({
      config: {
        ...config,
        payeeName: "<script>alert(1)</script>",
        instructions: "<img src=x onerror=alert(1)>",
      },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
});
