import { normalizeDomain, normalizeEmail } from "./normalization";
import { lookup } from "node:dns/promises";

export type VerificationCheck = {
  fieldKey: string;
  checkType: "syntax" | "domain" | "website_relationship" | "cross_source";
  checkState: "passed" | "failed" | "not_run" | "conflicting";
  confidence: number;
  details: Record<string, unknown>;
};

export function verifyEmailAndWebsite(email?: string | null, website?: string | null): {
  state: "verified" | "partially_verified" | "unverified" | "conflicting" | "unavailable";
  confidence: number;
  checks: VerificationCheck[];
} {
  if (!email) {
    return {
      state: "unavailable",
      confidence: 0,
      checks: [{ fieldKey: "publicEmail", checkType: "syntax", checkState: "not_run", confidence: 0, details: { reason: "No public email supplied." } }],
    };
  }

  const canonicalEmail = normalizeEmail(email);
  if (!canonicalEmail) {
    return {
      state: "unverified",
      confidence: 0.1,
      checks: [{ fieldKey: "publicEmail", checkType: "syntax", checkState: "failed", confidence: 0.1, details: { reason: "Email does not match a basic public email syntax rule." } }],
    };
  }

  const emailDomain = canonicalEmail.split("@")[1];
  const websiteDomain = normalizeDomain(website);
  const relationshipMatches = Boolean(websiteDomain && (emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`)));
  const checks: VerificationCheck[] = [
    { fieldKey: "publicEmail", checkType: "syntax", checkState: "passed", confidence: 0.5, details: { email: canonicalEmail } },
    { fieldKey: "publicEmail", checkType: "domain", checkState: "not_run", confidence: 0.5, details: { emailDomain, reason: "Domain lookup is run during enrichment." } },
    {
      fieldKey: "publicEmail",
      checkType: "website_relationship",
      checkState: websiteDomain ? relationshipMatches ? "passed" : "failed" : "not_run",
      confidence: relationshipMatches ? 0.9 : websiteDomain ? 0.45 : 0.65,
      details: { emailDomain, websiteDomain },
    },
  ];

  return {
    state: relationshipMatches ? "partially_verified" : "unverified",
    confidence: relationshipMatches ? 0.9 : 0.65,
    checks,
  };
}

export async function verifyEmailDomainExistence(email?: string | null): Promise<VerificationCheck> {
  const canonicalEmail = normalizeEmail(email);
  if (!canonicalEmail) return { fieldKey: "publicEmail", checkType: "domain", checkState: "not_run", confidence: 0, details: { reason: "No syntactically valid email is available for domain lookup." } };
  const emailDomain = canonicalEmail.split("@")[1];
  try {
    const records = await lookup(emailDomain, { all: true });
    return { fieldKey: "publicEmail", checkType: "domain", checkState: records.length ? "passed" : "failed", confidence: records.length ? 0.78 : 0.2, details: { emailDomain, resolvedAddresses: records.map(record => record.address) } };
  } catch {
    return { fieldKey: "publicEmail", checkType: "domain", checkState: "failed", confidence: 0.2, details: { emailDomain, reason: "DNS lookup did not resolve the email domain." } };
  }
}
