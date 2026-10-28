import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatCards, formatDuration, type StatCardsData } from "./StatCards";

function makeData(over: Partial<StatCardsData> = {}): StatCardsData {
  return {
    views: 500,
    starts: 310,
    completions: 190,
    completionRateViews: 38,
    completionRateStarts: 61,
    avgTime: { medianSeconds: 125, meanSeconds: 140, sampleSize: 120 },
    filterActive: false,
    rangeActive: false,
    ...over,
  };
}

describe("formatDuration", () => {
  it("formats sub-minute as seconds", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes and padded seconds", () => {
    expect(formatDuration(125)).toBe("2m 05s");
  });

  it("returns an em dash for null / invalid", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("StatCards", () => {
  it("renders the five headline metrics", () => {
    const html = renderToStaticMarkup(<StatCards data={makeData()} />);
    expect(html).toContain("Views");
    expect(html).toContain("Starts");
    expect(html).toContain("Completions");
    expect(html).toContain("Completion rate");
    expect(html).toContain("Avg. time (approx.)");
    expect(html).toContain("61%"); // start -> completion headline
    expect(html).toContain("38%"); // view -> completion subline
    expect(html).toContain("2m 05s"); // median avg time
  });

  it("does NOT show the unfilterable badge when no filter is active", () => {
    const html = renderToStaticMarkup(<StatCards data={makeData()} />);
    expect(html).not.toContain("not answer-filterable");
  });

  it("shows a 'total (not answer-filterable)' badge on Views/Starts under a filter", () => {
    const html = renderToStaticMarkup(
      <StatCards data={makeData({ filterActive: true, rangeActive: false })} />,
    );
    expect(html).toContain("total (not answer-filterable)");
  });

  it("uses 'range total' wording when a date range is also active", () => {
    const html = renderToStaticMarkup(
      <StatCards data={makeData({ filterActive: true, rangeActive: true })} />,
    );
    expect(html).toContain("range total (not answer-filterable)");
  });

  it("renders empty / zero states with em dashes and a no-timing note", () => {
    const html = renderToStaticMarkup(
      <StatCards
        data={makeData({
          views: 0,
          starts: 0,
          completions: 0,
          completionRateViews: null,
          completionRateStarts: null,
          avgTime: { medianSeconds: null, meanSeconds: null, sampleSize: 0 },
        })}
      />,
    );
    expect(html).toContain("—"); // null rates / avg time
    expect(html).toContain("Not enough timing data yet");
  });
});
