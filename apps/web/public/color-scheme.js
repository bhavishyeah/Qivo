// Set the colour scheme synchronously, before first paint, to avoid a flash of
// the wrong theme. Stored manual choice wins; otherwise the OS preference.
//
// This lives in a file (not an inline <script> in index.html) because the CSP
// (`script-src 'self' ...`) does not allow inline scripts. It must stay in sync
// with src/lib/colorScheme.ts: same storage key and same `data-color-scheme`
// attribute (a test enforces the key).
(function () {
  try {
    // Respondent routes (public form, projector page, builder preview) are
    // always light: skip the stored/OS preference so there is no dark flash.
    if (/^\/(f\/|forms\/[^/]+\/preview\/?$)/.test(location.pathname)) {
      document.documentElement.dataset.colorScheme = "light";
      return;
    }
    var s = localStorage.getItem("qivo-color-scheme");
    if (s !== "light" && s !== "dark") {
      s =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }
    document.documentElement.dataset.colorScheme = s;
  } catch (e) {
    document.documentElement.dataset.colorScheme = "light";
  }
})();
