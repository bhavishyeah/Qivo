import { createHash } from "node:crypto";

/**
 * Server-side Cloudinary signing for direct browser uploads.
 *
 * The browser uploads files straight to Cloudinary (no bytes through our API);
 * we only hand it a short-lived signature. The API secret never leaves the
 * server. Uses Cloudinary's signing scheme: SHA-1 of the sorted, &-joined
 * params to sign, with the api_secret appended.
 */

export type CloudinarySignature = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
};

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

/**
 * Build a signature for an upload into `folder`. Only the params included here
 * are signed, so the client must send exactly these (plus file + api_key +
 * timestamp + signature) to Cloudinary.
 */
export function signUpload(folder: string): CloudinarySignature {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("File uploads are not configured.");
    error.name = "UPLOAD_NOT_CONFIGURED";
    throw error;
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Params to sign, sorted alphabetically by key and joined with &.
  const paramsToSign: Record<string, string | number> = {
    folder,
    timestamp,
  };
  const toSign = Object.keys(paramsToSign)
    .sort()
    .map((key) => `${key}=${paramsToSign[key]}`)
    .join("&");

  const signature = createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");

  return { cloudName, apiKey, timestamp, signature, folder };
}
