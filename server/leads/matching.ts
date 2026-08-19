export type LeadIdentity = {
  canonicalDomain?: string | null;
  canonicalPhone?: string | null;
  canonicalName: string;
  canonicalLocation?: string | null;
};

export type MatchResult = {
  score: number;
  signals: string[];
  shouldMerge: boolean;
  isCandidate: boolean;
};

export function compareLeadIdentity(incoming: LeadIdentity, existing: LeadIdentity): MatchResult {
  let score = 0;
  const signals: string[] = [];

  if (incoming.canonicalDomain && existing.canonicalDomain && incoming.canonicalDomain === existing.canonicalDomain) {
    score += 0.72;
    signals.push("exact_domain");
  }

  if (incoming.canonicalPhone && existing.canonicalPhone && incoming.canonicalPhone === existing.canonicalPhone) {
    score += 0.64;
    signals.push("exact_phone");
  }

  if (incoming.canonicalName && incoming.canonicalName === existing.canonicalName) {
    score += 0.2;
    signals.push("exact_name");
  }

  if (
    incoming.canonicalLocation &&
    existing.canonicalLocation &&
    incoming.canonicalLocation === existing.canonicalLocation
  ) {
    score += 0.18;
    signals.push("exact_location");
  }

  const boundedScore = Math.min(score, 1);
  return {
    score: boundedScore,
    signals,
    shouldMerge: boundedScore >= 0.82 || signals.includes("exact_domain") && signals.includes("exact_phone"),
    isCandidate: boundedScore >= 0.45,
  };
}
