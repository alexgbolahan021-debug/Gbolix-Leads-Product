import type { LeadInput } from "@shared/leadContracts";

const nonAlphanumeric = /[^a-z0-9]+/g;

export function normalizeDomain(value?: string | null) {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.hostname.replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

export function normalizePhone(value?: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

export function normalizeEmail(value?: string | null) {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  const match = email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  return match ? email : null;
}

export function normalizeText(value?: string | null) {
  if (!value) return "";
  return value.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeName(value: string) {
  return normalizeText(value)
    .replace(/\b(inc|ltd|limited|llc|plc|corp|corporation|company|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLocation(input: Pick<LeadInput, "country" | "region" | "city" | "address" | "postalCode">) {
  return [input.country, input.region, input.city, input.address, input.postalCode]
    .map(part => normalizeText(part))
    .filter(Boolean)
    .join("|");
}

export function safeWebsiteUrl(value?: string | null) {
  const domain = normalizeDomain(value);
  return domain ? `https://${domain}` : null;
}

export function makeStableRequestId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function slugifyCategory(value?: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(nonAlphanumeric, "-").replace(/^-|-$/g, "");
  return normalized || null;
}
