import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FunnelChart, type FunnelData } from "./FunnelChart";

// Base unfiltered funnel fixture; override per test.
function makeFunnel(over: Partial<FunnelData> = {}): FunnelData {
  return {
    views: 500,
    starts: 310,
    completions: 190,
    viewToStart: 62,
    startToCompletion: 61,
    viewToCompletion: 38,
    filterAffectsCompletionsOnly: false,
    ...over,
  };
}

describe("FunnelChart", () => {
  it("renders all three stages with counts", () => {
    const html = renderToStaticMarkup(<FunnelChart data={makeFunnel()} />);
    expect(html).toContain("Views");
    expect(html).toContain("Starts");
    expect(html).toContain("Completions");
    expect(html).toContain("500");
    expect(html).toContain("310");
    expect(html).toContain("190");
  });

  it("shows conversion and drop-off when no filter is active", () => {
    const html = renderToStaticMarkup(<FunnelChart data={makeFunnel()} />);
    expect(html).toContain("62% continue");
    expect(html).toContain("drop-off");
    // No suppression note when unfiltered.
    expect(html).not.toContain("matching your filter");
  });

  it("suppresses conversion percentages when a cross-question filter is active", () => {
    const html = renderToStaticMarkup(
      <FunnelChart data={makeFunnel({ filterAffectsCompletionsOnly: true })} />,
    );
    // The transition rates must not render.
    expect(html).not.toContain("% continue");
    // Instead, the honest note + unfilterable badges appear.
    expect(html).toContain("matching your filter");
    expect(html).toContain("not answer-filterable");
    // aria-label summary mentions the hidden-percentage reason.
    expect(html).toContain("hidden because an answer filter is active");
  });

  it("exposes an aria-label text alternative summarizing the funnel", () => {
    const html = renderToStaticMarkup(<FunnelChart data={makeFunnel()} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("Funnel: 500 views, 310 starts, 190 completions.");
    expect(html).toContain("Overall conversion 38 percent");
  });

  it("clamps starts > views with a ≥100% note", () => {
    const html = renderToStaticMarkup(
      <FunnelChart data={makeFunnel({ views: 100, starts: 140, viewToStart: null })} />,
    );
    expect(html).toContain("≥100%");
  });

  it("handles the all-zero empty state without crashing", () => {
    const html = renderToStaticMarkup(
      <FunnelChart
        data={makeFunnel({
          views: 0,
          starts: 0,
          completions: 0,
          viewToStart: null,
          startToCompletion: null,
          viewToCompletion: null,
        })}
      />,
    );
    expect(html).toContain("Views");
    expect(html).toContain("Funnel: 0 views, 0 starts, 0 completions.");
    // viewToCompletion null -> "not available" in the aria summary.
    expect(html).toContain("Overall conversion not available");
  });
});
