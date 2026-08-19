import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { normalizeEmail, normalizePhone, safeWebsiteUrl } from "./normalization";

export type WebsiteEvidence = {
  retrievalStatus: "captured" | "blocked" | "failed";
  sourceUrl: string;
  pageTitle: string | null;
  excerpt: string | null;
  contentHash: string | null;
  publicEmails: string[];
  phones: string[];
  hasSocialSignal: boolean;
  hasBookingSignal: boolean;
  hasEcommerceSignal: boolean;
  error?: string;
};

function isPrivateAddress(address: string) {
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address) || address === "::1" || address.startsWith("fc") || address.startsWith("fd");
}

async function assertPublicUrl(urlValue: string) {
  const url = new URL(urlValue);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS website evidence can be retrieved.");
  if (["localhost", "0.0.0.0", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Local and loopback addresses are blocked.");
  const resolved = await lookup(url.hostname, { all: true });
  if (!resolved.length || resolved.some(record => isPrivateAddress(record.address))) throw new Error("Private network targets are blocked.");
  return url;
}

export async function retrieveWebsiteEvidence(website?: string | null): Promise<WebsiteEvidence> {
  const sourceUrl = safeWebsiteUrl(website);
  if (!sourceUrl) {
    return { retrievalStatus: "blocked", sourceUrl: website ?? "", pageTitle: null, excerpt: null, contentHash: null, publicEmails: [], phones: [], hasSocialSignal: false, hasBookingSignal: false, hasEcommerceSignal: false, error: "No valid public website URL was supplied." };
  }
  try {
    const url = await assertPublicUrl(sourceUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_500);
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "GbolixLeadsEvidence/0.1 (+https://gbolix.site)" } });
    clearTimeout(timeout);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) throw new Error(`Website retrieval returned ${response.status || "an unsupported response"}.`);
    const html = (await response.text()).slice(0, 180_000);
    const compactText = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    const emails = Array.from(new Set((compactText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map(normalizeEmail).filter(Boolean) as string[])).slice(0, 8);
    const phones = Array.from(new Set((compactText.match(/(?:\+?\d[\d(). -]{6,}\d)/g) ?? []).map(normalizePhone).filter(Boolean) as string[])).slice(0, 8);
    return {
      retrievalStatus: "captured",
      sourceUrl: url.toString(),
      pageTitle: title,
      excerpt: compactText.slice(0, 1_200) || null,
      contentHash: createHash("sha256").update(html).digest("hex"),
      publicEmails: emails,
      phones,
      hasSocialSignal: /instagram\.com|facebook\.com|linkedin\.com|tiktok\.com/i.test(html),
      hasBookingSignal: /book now|reserve a table|appointment|schedule now|online booking/i.test(compactText),
      hasEcommerceSignal: /add to cart|checkout|shop now|woocommerce|shopify/i.test(html),
    };
  } catch (error) {
    return { retrievalStatus: "failed", sourceUrl, pageTitle: null, excerpt: null, contentHash: null, publicEmails: [], phones: [], hasSocialSignal: false, hasBookingSignal: false, hasEcommerceSignal: false, error: error instanceof Error ? error.message : "Unknown website retrieval error." };
  }
}
