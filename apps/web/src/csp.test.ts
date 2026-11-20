import { describe, expect, it } from "vitest";

import nginxConf from "../nginx.conf?raw";
import vercelRaw from "../vercel.json?raw";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };
const vercel = JSON.parse(vercelRaw) as { headers: HeaderRule[] };

const vercelCsp = vercel.headers
  .find((h) => h.source === "/(.*)")
  ?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
const nginxCsp = /set \$csp "([^"]+)";/.exec(nginxConf)?.[1];

describe("Content-Security-Policy", () => {
  it("is identical in vercel.json and nginx.conf", () => {
    expect(vercelCsp).toBeTruthy();
    expect(nginxCsp).toBe(vercelCsp);
  });

  it("serves fonts from self and keeps the Google Fonts origins used by per-form fonts", () => {
    expect(vercelCsp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(vercelCsp).toContain("https://fonts.googleapis.com");
  });

  it("every nginx location that sets add_header also sets the CSP", () => {
    const locations = [...nginxConf.matchAll(/location\s+\S+\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(locations.length).toBeGreaterThan(0);
    for (const body of locations) {
      if (body.includes("add_header")) expect(body).toContain("Content-Security-Policy $csp");
    }
  });

  it("caches self-hosted fonts on both deploy paths", () => {
    const fontsRule = vercel.headers.find((h) => h.source === "/fonts/(.*)");
    expect(fontsRule?.headers.some((h) => h.key === "Cache-Control")).toBe(true);
    expect(nginxConf).toMatch(/location \/fonts\/ \{[^}]*expires 30d/);
  });
});
