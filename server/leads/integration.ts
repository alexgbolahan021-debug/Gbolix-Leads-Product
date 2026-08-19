import { createHmac, timingSafeEqual } from "node:crypto";

type SignedPayload = {
  timestamp: string;
  payload: unknown;
};

export function signIntegrationPayload(secret: string, input: SignedPayload) {
  return createHmac("sha256", secret)
    .update(`${input.timestamp}.${JSON.stringify(input.payload)}`)
    .digest("hex");
}

export function verifyIntegrationSignature(secret: string, input: SignedPayload & { signature: string }) {
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) return false;
  const expected = signIntegrationPayload(secret, input);
  const provided = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}

export function getIntegrationSecret() {
  const secret = process.env.GBOLIX_INTEGRATION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GBOLIX_INTEGRATION_SECRET is required for signed Gbolix integration requests.");
  }
  return "gbolix-leads-local-mock-only";
}
