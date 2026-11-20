import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Logo from "./Logo";

const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<StaticRouter location="/">{node}</StaticRouter>);

describe("Logo", () => {
  it("renders the Qivo wordmark without a link by default", () => {
    const html = render(<Logo />);
    expect(html).toContain(">Qivo<");
    expect(html).not.toContain("<a ");
    expect(html).toContain("logo-md");
  });

  it("wraps the wordmark in a link when `to` is set", () => {
    const html = render(<Logo to="/dashboard" />);
    expect(html).toContain('<a ');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('aria-label="Qivo"');
  });

  it("renders the icon slot inside an aria-hidden span", () => {
    const html = render(<Logo icon={<svg data-testid="mark" />} />);
    expect(html).toMatch(/<span class="logo-icon" aria-hidden="true"><svg/);
  });

  it("applies size and tone classes", () => {
    const html = render(<Logo size="lg" tone="on-indigo" />);
    expect(html).toContain("logo-lg");
    expect(html).toContain("logo-on-indigo");
  });
});
