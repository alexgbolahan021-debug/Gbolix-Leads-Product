export type CrossSourceEmailResolution = {
  state: "verified" | "partially_verified" | "unverified" | "conflicting" | "unavailable";
  checkState: "passed" | "failed" | "not_run" | "conflicting";
  confidence: number;
  reason: string;
};

export function resolveCrossSourceValue(fieldKey: string, existingValue?: string | null, incomingValue?: string | null): CrossSourceEmailResolution {
  if (!incomingValue) return { state: "unavailable", checkState: "not_run", confidence: 0, reason: `No website ${fieldKey} value was extracted.` };
  if (!existingValue) return { state: "partially_verified", checkState: "not_run", confidence: 0.72, reason: `Only one source currently provides ${fieldKey}.` };
  if (existingValue.toLowerCase() === incomingValue.toLowerCase()) return { state: "verified", checkState: "passed", confidence: 0.96, reason: `User-provided and website evidence agree on ${fieldKey}.` };
  return { state: "conflicting", checkState: "conflicting", confidence: 0.25, reason: `User-provided and website evidence provide different ${fieldKey} values; neither value is silently promoted.` };
}

export function resolveCrossSourceEmail(existingEmail?: string | null, incomingEmail?: string | null) {
  return resolveCrossSourceValue("publicEmail", existingEmail, incomingEmail);
}

export function buildCrossSourceVerificationCheck(fieldKey: string, existingValue?: string | null, incomingValue?: string | null) {
  const resolution = resolveCrossSourceValue(fieldKey, existingValue, incomingValue);
  return {
    fieldKey,
    checkType: "cross_source" as const,
    checkState: resolution.checkState,
    confidence: resolution.confidence,
    details: {
      sources: ["user_provided", "business_website"],
      reason: resolution.reason,
      existingValue: existingValue ?? null,
      websiteValue: incomingValue ?? null,
    },
  };
}

export function usageEventIdempotencyKey(externalRequestId: string) {
  return `usage:${externalRequestId}`;
}

export const aiInferenceObservationPolicy = {
  origin: "ai_inferred" as const,
  verificationState: "unverified" as const,
  isCanonical: false,
};

export function exportAccessDecision(input: { requestedWorkspaceId: string; exportWorkspaceId: string; status: string; expiresAt?: Date | null; now?: Date }) {
  if (input.requestedWorkspaceId !== input.exportWorkspaceId) return { allowed: false, action: "denied" as const, reason: "workspace_mismatch" };
  const now = input.now ?? new Date();
  if (input.status !== "ready" || !input.expiresAt || input.expiresAt <= now) return { allowed: false, action: "expired" as const, reason: "export_unavailable_or_expired" };
  return { allowed: true, action: "downloaded" as const, reason: "workspace_authorized" };
}
