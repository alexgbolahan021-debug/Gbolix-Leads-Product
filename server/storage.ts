import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

type StorageResult = { key: string; url: string };

function normalizeKey(relKey: string) { return relKey.replace(/^\/+/, ""); }
function appendHashSuffix(relKey: string) { const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8); const dot = relKey.lastIndexOf("."); return dot === -1 ? `${relKey}_${hash}` : `${relKey.slice(0, dot)}_${hash}${relKey.slice(dot)}`; }

function s3Config() {
  const endpoint = process.env.S3_ENDPOINT; const region = process.env.S3_REGION; const bucket = process.env.S3_BUCKET; const accessKeyId = process.env.S3_ACCESS_KEY_ID; const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { bucket, publicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, ""), client: new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" }) };
}

function forgeConfig() {
  const forgeUrl = ENV.forgeApiUrl; const forgeKey = ENV.forgeApiKey;
  return forgeUrl && forgeKey ? { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey } : null;
}

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream"): Promise<StorageResult> {
  const key = appendHashSuffix(normalizeKey(relKey)); const s3 = s3Config();
  if (s3) {
    await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: data, ContentType: contentType }));
    return { key, url: s3.publicBaseUrl ? `${s3.publicBaseUrl}/${key}` : key };
  }
  const forge = forgeConfig();
  if (!forge) throw new Error("Object storage is not configured. Set S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.");
  const presignUrl = new URL("v1/storage/presign/put", `${forge.forgeUrl}/`); presignUrl.searchParams.set("path", key);
  const presign = await fetch(presignUrl, { headers: { Authorization: `Bearer ${forge.forgeKey}` } });
  if (!presign.ok) throw new Error(`Storage presign failed (${presign.status})`);
  const { url } = await presign.json() as { url: string };
  const uploaded = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data as any], { type: contentType }) });
  if (!uploaded.ok) throw new Error(`Storage upload failed (${uploaded.status})`);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<StorageResult> { const key = normalizeKey(relKey); const s3 = s3Config(); return { key, url: s3?.publicBaseUrl ? `${s3.publicBaseUrl}/${key}` : key }; }

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey); const s3 = s3Config();
  if (s3) return getSignedUrl(s3.client, new GetObjectCommand({ Bucket: s3.bucket, Key: key }), { expiresIn: 60 * 15 });
  const forge = forgeConfig(); if (!forge) throw new Error("Object storage is not configured.");
  const getUrl = new URL("v1/storage/presign/get", `${forge.forgeUrl}/`); getUrl.searchParams.set("path", key);
  const response = await fetch(getUrl, { headers: { Authorization: `Bearer ${forge.forgeKey}` } }); if (!response.ok) throw new Error(`Storage signed URL failed (${response.status})`);
  return (await response.json() as { url: string }).url;
}
