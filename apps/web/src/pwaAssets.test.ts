import { describe, expect, it } from "vitest";

import indexHtml from "../index.html?raw";
import manifestRaw from "../public/manifest.webmanifest?raw";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Chrome only offers "Install app" when the manifest lists real 192px and 512px
// icons. These tests fail if the manifest or <head> point at a file that is
// missing from public/, or if the icon list is emptied again.

type ManifestIcon = {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
};

const manifest = JSON.parse(manifestRaw) as {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  icons?: ManifestIcon[];
};

// Keys look like "../public/icons/foo.png" (relative to this test file).
const publicPngs = new Set(Object.keys(import.meta.glob("../public/**/*.png")));
const existsInPublic = (src: string) => publicPngs.has(`../public${src}`);

describe("web app manifest", () => {
  it("is installable-shaped (name, start_url, standalone)", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("lists 192x192 and 512x512 PNG icons for purpose 'any'", () => {
    const any = (manifest.icons ?? []).filter((i) => i.purpose === "any");
    for (const size of ["192x192", "512x512"]) {
      const icon = any.find((i) => i.sizes === size);
      expect(icon, `missing ${size} 'any' icon`).toBeDefined();
      expect(icon?.type).toBe("image/png");
    }
  });

  it("lists a maskable icon", () => {
    const maskable = (manifest.icons ?? []).filter(
      (i) => i.purpose === "maskable",
    );
    expect(maskable.length).toBeGreaterThan(0);
  });

  it("only references icon files that exist in public/", () => {
    for (const icon of manifest.icons ?? []) {
      expect(existsInPublic(icon.src), `missing file for ${icon.src}`).toBe(true);
    }
  });
});

describe("index.html icon links", () => {
  const hrefs = (rel: string) =>
    [...indexHtml.matchAll(new RegExp(`<link[^>]*rel="${rel}"[^>]*>`, "gi"))]
      .map((m) => /href="([^"]+)"/.exec(m[0])?.[1])
      .filter((h): h is string => Boolean(h));

  it("has a favicon and an apple-touch-icon", () => {
    expect(hrefs("icon").length).toBeGreaterThan(0);
    expect(hrefs("apple-touch-icon").length).toBe(1);
  });

  it("only references icon files that exist in public/", () => {
    for (const href of [...hrefs("icon"), ...hrefs("apple-touch-icon")]) {
      expect(existsInPublic(href), `missing file for ${href}`).toBe(true);
    }
  });
});

// vitest does not return CSS through ?raw, so read the file directly.
const fontsCss = readFileSync(fileURLToPath(new URL("./styles/fonts.css", import.meta.url)), "utf8");
const INDIGO = "#42005f";
const publicFonts = new Set(
  Object.keys(import.meta.glob("../public/fonts/*.woff2")).map((k) => k.split("/").pop()),
);

describe("brand colours and self-hosted fonts", () => {
  const colors = JSON.parse(manifestRaw) as { theme_color?: string; background_color?: string };

  it("manifest and theme-color meta use Indigo", () => {
    expect(colors.theme_color).toBe(INDIGO);
    expect(colors.background_color).toBe(INDIGO);
    expect(/<meta name="theme-color" content="([^"]+)"/.exec(indexHtml)?.[1]).toBe(INDIGO);
  });

  it("index.html has title, description and og tags", () => {
    expect(/<title>[^<]*Qivo[^<]*<\/title>/.test(indexHtml)).toBe(true);
    expect(indexHtml).toMatch(/<meta\s+name="description"/);
    expect(indexHtml).toMatch(/property="og:title"/);
    expect(indexHtml).toMatch(/property="og:description"/);
  });

  it("makes no Google Fonts request from index.html", () => {
    expect(indexHtml).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it("preloads only font files that exist in public/fonts", () => {
    const tags = [...indexHtml.matchAll(/<link[^>]*rel="preload"[^>]*as="font"[^>]*>/gi)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const href = /href="\/fonts\/([^"]+)"/.exec(tag)?.[1];
      expect(href && publicFonts.has(href), `missing preload file in ${tag}`).toBe(true);
      expect(tag).toContain("crossorigin");
    }
  });

  it("fonts.css references only font files that exist and makes no remote request", () => {
    const urls = [...fontsCss.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const file of urls) expect(publicFonts.has(file), `missing ${file}`).toBe(true);
    expect(fontsCss).not.toMatch(/https?:/);
  });
});
