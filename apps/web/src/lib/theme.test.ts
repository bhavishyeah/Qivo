import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  ensureFontLoaded,
  FONT_ALLOW_LIST,
  resolveTheme,
} from "./theme";

// Minimal DOM stub so ensureFontLoaded can be exercised under the plain `node`
// test environment (the web suite doesn't pull in jsdom). Only the surface
// ensureFontLoaded touches is implemented.
type StubLink = {
  rel: string;
  href: string;
  attrs: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
};

function installDocumentStub() {
  const links: StubLink[] = [];
  const head = {
    appendChild(node: StubLink) {
      links.push(node);
    },
    querySelectorAll(selector: string) {
      // Supports only link[data-qivo-font] and link[data-qivo-font="X"].
      const m = /^link\[data-qivo-font(?:="([^"]+)")?\]$/.exec(selector);
      if (!m) return [];
      const matched = links.filter((l) =>
        m[1] === undefined
          ? l.attrs["data-qivo-font"] !== undefined
          : l.attrs["data-qivo-font"] === m[1],
      );
      return {
        length: matched.length,
        forEach: (cb: (n: StubLink) => void) => matched.forEach(cb),
      };
    },
  };
  const doc = {
    head,
    createElement(): StubLink {
      const link: StubLink = {
        rel: "",
        href: "",
        attrs: {},
        setAttribute(name, value) {
          this.attrs[name] = value;
        },
      };
      return link;
    },
    querySelector(selector: string) {
      const res = head.querySelectorAll(selector);
      return res.length > 0 ? ({} as unknown) : null;
    },
  };
  (globalThis as { document?: unknown }).document = doc;
  return () => {
    links.length = 0;
  };
}

describe("resolveTheme", () => {
  it("prefers theme.accentColor over primaryColor", () => {
    expect(resolveTheme({ accentColor: "#111111" }, "#222222").accent).toBe(
      "#111111",
    );
  });

  it("falls back to primaryColor when no theme accent", () => {
    expect(resolveTheme({}, "#222222").accent).toBe("#222222");
    expect(resolveTheme(undefined, "#222222").accent).toBe("#222222");
  });

  it("returns undefined accent when neither is set", () => {
    expect(resolveTheme(undefined).accent).toBeUndefined();
    expect(resolveTheme({}).accent).toBeUndefined();
  });

  it("preview mode (no primaryColor) yields undefined accent without a theme accent", () => {
    expect(resolveTheme({ backgroundColor: "#fafafa" }).accent).toBeUndefined();
  });

  it("never substitutes DEFAULT_ACCENT in the resolver", () => {
    expect(resolveTheme(undefined, null).accent).not.toBe(DEFAULT_ACCENT);
    expect(resolveTheme(undefined, null).accent).toBeUndefined();
  });

  it("resolves background, cover, and a font stack when set", () => {
    const r = resolveTheme({
      backgroundColor: "#f0f0f0",
      coverImageUrl: "https://example.com/c.png",
      fontFamily: "Playfair Display",
    });
    expect(r.background).toBe("#f0f0f0");
    expect(r.coverImageUrl).toBe("https://example.com/c.png");
    expect(r.fontFamily).toContain("Playfair Display");
  });

  it("ignores an unknown stored font family", () => {
    expect(
      resolveTheme({ fontFamily: "Comic Sans MS" }).fontFamily,
    ).toBeUndefined();
  });
});

describe("ensureFontLoaded", () => {
  let reset: () => void;
  const doc = () => (globalThis as { document: Document }).document;

  beforeEach(() => {
    reset = installDocumentStub();
  });
  afterEach(() => {
    reset();
    delete (globalThis as { document?: unknown }).document;
  });

  it("injects a link once per family", () => {
    ensureFontLoaded("Inter");
    ensureFontLoaded("Inter");
    expect(
      doc().head.querySelectorAll('link[data-qivo-font="Inter"]').length,
    ).toBe(1);
  });

  it("no-ops on undefined", () => {
    ensureFontLoaded(undefined);
    expect(doc().head.querySelectorAll("link[data-qivo-font]").length).toBe(0);
  });

  it("no-ops on a non-allow-list family", () => {
    ensureFontLoaded("Comic Sans MS");
    expect(doc().head.querySelectorAll("link[data-qivo-font]").length).toBe(0);
  });
});

describe("FONT_ALLOW_LIST", () => {
  it("deep-equals the eight expected families", () => {
    expect([...FONT_ALLOW_LIST]).toEqual([
      "Inter",
      "Roboto",
      "Poppins",
      "Montserrat",
      "Open Sans",
      "Lora",
      "Playfair Display",
      "Source Sans 3",
    ]);
  });
});
