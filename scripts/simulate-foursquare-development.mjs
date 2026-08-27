import { leadInputSchema } from "../shared/leadContracts.ts";
import { normalizeDomain, normalizeLocation, normalizeName, normalizePhone } from "../server/leads/normalization.ts";
import { compareLeadIdentity } from "../server/leads/matching.ts";
import { scoreLead } from "../server/leads/scoring.ts";
import { verifyEmailAndWebsite } from "../server/leads/verification.ts";

process.env.NODE_ENV = "development";
process.env.FOURSQUARE_MOCK_MODE = "true";

const { foursquarePlacesAdapter } = await import("../server/leads/adapters.ts");

const city = process.env.FOURSQUARE_TEST_CITY ?? "Austin";
const country = process.env.FOURSQUARE_TEST_COUNTRY ?? "US";
const requested = Math.min(100, Math.max(1, Number(process.env.FOURSQUARE_TEST_LIMIT ?? 100)));
const discovery = await foursquarePlacesAdapter.discover({ cities: [city], country, categoryCode: "restaurants", limit: requested });

const normalized = discovery.records.map(record => {
  const valid = leadInputSchema.parse(record);
  return {
    ...valid,
    canonicalDomain: normalizeDomain(valid.website),
    canonicalPhone: normalizePhone(valid.phone),
    canonicalName: normalizeName(valid.businessName),
    canonicalLocation: normalizeLocation(valid),
  };
});

const unique = [];
let duplicatesSuppressed = 0;
for (const candidate of normalized) {
  const existing = unique.find(item => compareLeadIdentity(candidate, item).shouldMerge);
  if (existing) duplicatesSuppressed += 1;
  else unique.push(candidate);
}

const verified = unique.map(candidate => ({
  candidate,
  verification: verifyEmailAndWebsite(candidate.email, candidate.website),
}));
const scored = verified.map(({ candidate, verification }) => ({
  ...candidate,
  verificationState: verification.state,
  score: scoreLead({ categoryCode: candidate.categoryCode, website: candidate.website, publicEmail: candidate.email, phone: candidate.phone, verificationState: verification.state }).totalScore,
}));

const summary = {
  mode: "foursquare-development-fixture",
  provider: "foursquare-places-v1",
  city,
  country,
  requested,
  stages: {
    discoveryReturned: discovery.records.length,
    schemaValidated: normalized.length,
    duplicatesSuppressed,
    candidatesAfterDeduplication: unique.length,
    websiteEnrichment: "available to the existing enrichment worker; skipped in fixture mode to avoid network calls",
    verificationCompleted: verified.length,
    deterministicScoresCompleted: scored.length,
    aiGateway: "preserved for downstream evidence inference; no production AI credential used",
  },
  provenance: discovery.provenance.slice(0, 3),
  sampleResults: scored.slice(0, 5).map(({ businessName, city: resultCity, country: resultCountry, website, phone, score, verificationState }) => ({ businessName, city: resultCity, country: resultCountry, website, phone, score, verificationState })),
  safeguards: {
    externalFoursquareCredentialUsed: false,
    productionDatabaseTouched: false,
    productionStorageTouched: false,
    maximumRecords: 100,
  },
};

console.log(JSON.stringify(summary, null, 2));
