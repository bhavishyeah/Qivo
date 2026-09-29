// Shared file-upload helpers used by the public form and the response/report
// views. Kept in a plain module (not a component file) so React Fast Refresh
// stays happy and the helpers can be imported anywhere.

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
