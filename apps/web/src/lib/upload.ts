// Shared file-upload helpers used by the public form and the response/report
// views. Kept in a plain module (not a component file) so React Fast Refresh
// stays happy and the helpers can be imported anywhere.

import { publicPost } from "./api";

/**
 * True only for URLs that point at an actual image we can render as an <img>.
 * The file extension is authoritative: a .pdf served under Cloudinary's
 * /image/ path is still NOT a renderable image, so we key off the extension
 * and never off the path alone. Extensionless URLs fall back to the /image/
 * path hint.
 */
export function isImageUrl(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;

  const extMatch = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];
    return imageExts.includes(ext);
  }

  // No extension — trust the Cloudinary image delivery path.
  return /\/image\/upload\//.test(url);
}

/**
 * Downscale + recompress an image in the browser before uploading. Large phone
 * photos (several MB) dominate upload time; resizing to a max edge and encoding
 * as JPEG typically shrinks them by 5-20x with no visible quality loss for form
 * attachments. Returns the original file untouched for non-images, for GIFs
 * (animation would be lost), or if anything goes wrong.
 */
export async function maybeCompressImage(file: File): Promise<File> {
  const MAX_EDGE = 1600; // longest side, in px
  const QUALITY = 0.82;

  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));

    // Already small enough — don't re-encode (avoids upsizing tiny images).
    if (scale === 1 && file.size <= 1_000_000) {
      bitmap.close();
      return file;
    }

    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) {
      // Compression didn't help — keep the original.
      return file;
    }

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    // If the browser can't decode it, upload the original untouched.
    return file;
  }
}

/**
 * Upload a file straight to Cloudinary for a given published form slug, using a
 * short-lived signature from our API. Images are compressed first and uploaded
 * via the "image" resource type; everything else (PDFs/documents) goes via
 * "raw" so Cloudinary serves it as a plain downloadable file. Resolves to the
 * delivered secure URL. Throws on any failure (signature request, network,
 * non-2xx, or missing secure_url) so the caller can surface an inline error.
 *
 * The form must be PUBLISHED — the signature endpoint is gated on that and
 * returns a 404 (PUBLIC_FORM_NOT_FOUND) otherwise.
 */
export async function uploadToCloudinary(
  slug: string,
  rawFile: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  // 0) For images, downscale + recompress in the browser before sending.
  const file = await maybeCompressImage(rawFile);

  // 1) Get a short-lived signature from our API (form must be published).
  const sig = await publicPost<{
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
  }>(`/api/forms/public/${slug}/upload-signature?t=${Date.now()}`, {});

  // 2) Upload straight to Cloudinary (bytes never touch our API). Use XHR so we
  // can report real upload progress.
  //
  // Resource type matters for delivery: real images use "image" (enables
  // transformations/thumbnails). Everything else — PDFs and other documents —
  // MUST use "raw". If a PDF goes through "auto", Cloudinary classifies it as
  // an image and then blocks public delivery of it (401 "deny or ACL failure").
  // "raw" stores/serves it as a plain downloadable file.
  const body = new FormData();
  body.append("file", file);
  body.append("api_key", sig.apiKey);
  body.append("timestamp", String(sig.timestamp));
  body.append("signature", sig.signature);
  body.append("folder", sig.folder);

  const resourceType = file.type.startsWith("image/") ? "image" : "raw";
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `https://api.cloudinary.com/v1_1/${sig.cloudName}/${resourceType}/upload`,
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { secure_url?: string };
          if (data.secure_url) resolve(data.secure_url);
          else reject(new Error("Upload failed. Please try again."));
        } catch {
          reject(new Error("Upload failed. Please try again."));
        }
      } else {
        reject(new Error("Upload failed. Please try again."));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Please try again."));
    xhr.send(body);
  });
}
