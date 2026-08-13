import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 (S3-compatible) storage for ceremony/session recordings.
 * Uploads happen from the admin console; customers receive 7-day
 * signed download links by email.
 */

function getR2(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const bucket = () => process.env.R2_BUCKET ?? "ghartira-recordings";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export async function getUploadUrl(key: string, contentType: string) {
  const r2 = getR2();
  if (!r2) return null;
  return getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: 60 * 60 },
  );
}

export async function getDownloadUrl(key: string) {
  const r2 = getR2();
  if (!r2) return null;
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: SEVEN_DAYS },
  );
}
