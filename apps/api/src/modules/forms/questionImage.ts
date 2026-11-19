// Cloudinary delivery hosts accepted for uploaded files/images. Host-matched via
// the URL parser's `.hostname` (never a regex over the raw string) so tricks like
// `res.cloudinary.com.evil.com` or userinfo are rejected.
export const CLOUDINARY_DELIVERY_HOSTS = new Set(["res.cloudinary.com"]);

const QUESTION_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const INVALID_IMAGE = "The image must be uploaded through the form editor.";

/**
 * Validate a question image URL. Returns a user-facing reason, or null when
 * acceptable: https, Cloudinary delivery host, an `/image/upload/` path, a
 * png/jpg/jpeg/gif/webp (or extensionless) file and, when CLOUDINARY_CLOUD_NAME
 * is set, this app's cloud.
 */
export function validateQuestionImageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return INVALID_IMAGE;
  }
  if (parsed.protocol !== "https:") return INVALID_IMAGE;
  if (!CLOUDINARY_DELIVERY_HOSTS.has(parsed.hostname)) return INVALID_IMAGE;
  if (!parsed.pathname.includes("/image/upload/")) return INVALID_IMAGE;

  const lastSeg = parsed.pathname.split("/").pop() ?? "";
  const dot = lastSeg.lastIndexOf(".");
  const ext = dot > 0 ? lastSeg.slice(dot + 1).toLowerCase() : "";
  if (ext !== "" && !QUESTION_IMAGE_EXTENSIONS.has(ext)) return INVALID_IMAGE;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloudName && !parsed.pathname.startsWith(`/${cloudName}/`)) {
    return INVALID_IMAGE;
  }
  return null;
}
