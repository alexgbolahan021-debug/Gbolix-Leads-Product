import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDomainList, parseLeadCsv } from "./csv";
import { signIntegrationPayload, verifyIntegrationSignature } from "./integration";
import { compareLeadIdentity } from "./matching";
import { scoreLead } from "./scoring";
import { verifyEmailAndWebsite } from "./verification";
import { leadInputSchema } from "@shared/leadContracts";
import { aiInferenceObservationPolicy, buildCrossSourceVerificationCheck, exportAccessDecision, resolveCrossSourceEmail, resolveCrossSourceValue, usageEventIdempotencyKey } from "./policy";
import { FixedWindowRateLimiter } from "./rateLimit";
import { getAdapterCatalog, googlePlacesAdapter, mapOpenStreetMapElement, openStreetMapPilotAdapter } from "./adapters";
import { buildGbolixUsageCallback, buildOpenStreetMapRequestMetadata, gbolixLeadIntakeSchema, verifyGbolixInboundSignature } from "../integrations/gbolixControlPlane";

describe("controlled source parsing", () => {
  it("permits a new taxonomy code without changing the input contract", () => {
    expect(leadInputSchema.parse({ businessName: "Northline Contractors", categoryCode: "contractors" }).categoryCode).toBe("contractors");
  });

  it("maps recognized CSV headers and returns validated business rows", () => {
    const parsed = parseLeadCsv("Company Name,Website,Email,City\nRiver House,river.example,hello@river.example,Lagos");
    expect(parsed.invalid).toEqual([]);
    expect(parsed.mapping.businessName).toBe("Company Name");
    expect(parsed.valid[0]).toMatchObject({ businessName: "River House", website: "river.example", email: "hello@river.example", city: "Lagos" });
  });

  it("rejects CSV inputs without a business-name column", () => {
    const parsed = parseLeadCsv("Website,Email\nriver.example,hello@river.example");
    expect(parsed.valid).toEqual([]);
    expect(parsed.invalid[0]?.message).toContain("business name");
  });

  it("normalizes acceptable domain-list entries into lead inputs", () => {
    const parsed = parseDomainList("https://www.river.example\ninvalid\nshore.example");
    expect(parsed.valid).toHaveLength(2);
    expect(parsed.invalid).toHaveLength(1);
    expect(parsed.valid[0]?.businessName).toBe("river.example");
  });
});

describe("OpenStreetMap pilot mapping", () => {
  it("maps public place tags into a lead while retaining category and city context", () => {
    expect(mapOpenStreetMapElement({ type: "node", id: 42, tags: { name: "River House", website: "https://river.example", "contact:phone": "+1 555 0100", "addr:city": "Chicago", "addr:country": "us" } }, { city: "Chicago", country: "US" }, "restaurants")).toMatchObject({ businessName: "River House", website: "https://river.example", phone: "+1 555 0100", city: "Chicago", country: "US", categoryCode: "restaurants" });
  });

  it("drops an OpenStreetMap record without a public business name", () => {
    expect(mapOpenStreetMapElement({ type: "way", id: 99, tags: { website: "https://unnamed.example" } }, { city: "Chicago", country: "US" }, "restaurants")).toBeNull();
  });

  it("resolves a city-only request through structured city lookup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: "9.0643305", lon: "7.4892974", address: { country_code: "ng" } }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await openStreetMapPilotAdapter.discover({ categoryCode: "restaurants", cities: ["Abuja"], country: "Nigeria", limit: 3 });
      const geocoderUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(geocoderUrl).toContain("city=Abuja");
      expect(geocoderUrl).toContain("country=Nigeria");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back when the primary Overpass endpoint refuses the connection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: "9.0643305", lon: "7.4892974", address: { country_code: "ng" } }]), { status: 200 }))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await openStreetMapPilotAdapter.discover({ categoryCode: "restaurants", cities: ["Kaduna failover test"], country: "Nigeria", limit: 3 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queries both recognized public estate-agency tag variants within the existing pilot cap", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: "6.5244", lon: "3.3792", address: { country_code: "ng" } }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await openStreetMapPilotAdapter.discover({ categoryCode: "real-estate", cities: ["Lagos regression test"], limit: 5 });
      const overpassBody = String(fetchMock.mock.calls[1]?.[1]?.body);
      expect(overpassBody).toContain('office%22%3D%22estate_agent');
      expect(overpassBody).toContain('shop%22%3D%22estate_agent');
      expect(overpassBody).toContain('out+center+tags+5');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("identity resolution", () => {
  it("auto-merges when multiple strong signals agree", () => {
    const result = compareLeadIdentity(
      { canonicalDomain: "river.example", canonicalPhone: "15550101000", canonicalName: "river house", canonicalLocation: "us|il|chicago" },
      { canonicalDomain: "river.example", canonicalPhone: "15550101000", canonicalName: "river house", canonicalLocation: "us|il|chicago" }
    );
    expect(result.shouldMerge).toBe(true);
    expect(result.signals).toEqual(expect.arrayContaining(["exact_domain", "exact_phone"]));
  });

  it("keeps weak name-only similarity below the merge threshold", () => {
    const result = compareLeadIdentity(
      { canonicalName: "river house", canonicalLocation: "" },
      { canonicalName: "river house", canonicalLocation: "different location" }
    );
    expect(result.shouldMerge).toBe(false);
    expect(result.isCandidate).toBe(false);
  });
});

describe("verification and scoring", () => {
  it("marks a public email as partially verified when it matches the supplied website domain", () => {
    const result = verifyEmailAndWebsite("hello@river.example", "https://www.river.example");
    expect(result.state).toBe("partially_verified");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("produces explicit website-gap and contactability reasons", () => {
    const result = scoreLead({ categoryCode: "restaurants", publicEmail: "hello@river.example", phone: "15550101000", verificationState: "partially_verified", hasSocialSignal: true });
    expect(result.totalScore).toBeGreaterThan(50);
    expect(result.components.map(component => component.reasonCode)).toEqual(expect.arrayContaining(["NO_WEBSITE_DETECTED", "PUBLIC_EMAIL_AVAILABLE", "PARTIALLY_VERIFIED_CONTACT"]));
  });

  it("retains disagreeing source values as a conflict rather than silently promoting either one", () => {
    expect(resolveCrossSourceEmail("hello@river.example", "team@river.example")).toMatchObject({ state: "conflicting", checkState: "conflicting" });
  });

  it("applies the same conflict guard to a website phone value", () => {
    expect(resolveCrossSourceValue("phone", "15550101000", "15550109999")).toMatchObject({ state: "conflicting", checkState: "conflicting" });
  });

  it("constructs a persisted phone cross-source conflict check", () => {
    expect(buildCrossSourceVerificationCheck("phone", "15550101000", "15550109999")).toMatchObject({ fieldKey: "phone", checkType: "cross_source", checkState: "conflicting" });
  });
});

describe("signed mock Gbolix integration", () => {
  it("accepts a current, matching signature and rejects a modified payload", () => {
    const secret = "test-secret";
    const timestamp = new Date().toISOString();
    const payload = { externalRequestId: "gbolix-request-123", credits: 2 };
    const signature = signIntegrationPayload(secret, { timestamp, payload });
    expect(verifyIntegrationSignature(secret, { timestamp, payload, signature })).toBe(true);
    expect(verifyIntegrationSignature(secret, { timestamp, payload: { ...payload, credits: 3 }, signature })).toBe(false);
  });

  it("derives one stable credit event key for a retried request", () => {
    expect(usageEventIdempotencyKey("gbolix-request-123")).toBe(usageEventIdempotencyKey("gbolix-request-123"));
  });
});

describe("signed Gbolix control-plane boundary", () => {
  it("accepts a current signed request and rejects a modified payload", () => {
    const secret = "control-plane-test-secret";
    const timestamp = new Date().toISOString();
    const payload = { externalRequestId: "grq_12345678", externalWorkspaceId: "gws_1" };
    const signature = signIntegrationPayload(secret, { timestamp, payload });
    expect(verifyGbolixInboundSignature(secret, timestamp, signature, payload)).toBe(true);
    expect(verifyGbolixInboundSignature(secret, timestamp, signature, { ...payload, externalWorkspaceId: "gws_2" })).toBe(false);
  });

  it("rejects a stale control-plane signature", () => {
    const secret = "control-plane-test-secret";
    const timestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const payload = { externalRequestId: "grq_12345678" };
    const signature = signIntegrationPayload(secret, { timestamp, payload });
    expect(verifyGbolixInboundSignature(secret, timestamp, signature, payload)).toBe(false);
  });

  it("creates a signed usage callback with measured new-qualified and duplicate counts", () => {
    const callback = buildGbolixUsageCallback("callback-test-secret", { externalRequestId: "grq_12345678", jobId: "job_123", createdCount: 40, duplicateCount: 10 });
    expect(callback.body.eventType).toBe("lead_usage_finalized");
    expect(callback.body.usage).toEqual({ newQualifiedLeads: 40, duplicatesSuppressed: 10 });
    expect(verifyGbolixInboundSignature("callback-test-secret", callback.timestamp, callback.signature, callback.body)).toBe(true);
  });

  it("accepts customer constraints in a bounded OpenStreetMap discovery request", () => {
    const parsed = gbolixLeadIntakeSchema.parse({ externalRequestId: "grq_12345678", externalWorkspaceId: "gws_1", creditAuthorizationId: "auth_123456", label: "Lagos restaurants", inputType: "openstreetmap_discovery", rawContent: "", categoryCode: "restaurants", keywords: ["website", "automation"], discovery: { adapterKey: "openstreetmap-pilot-v1", city: "Lagos, Nigeria", limit: 5 } });
    expect(parsed.keywords).toEqual(["website", "automation"]);
    expect(parsed.discovery?.limit).toBe(5);
  });

  it("rejects discovery requests with more than eight optional constraints", () => {
    expect(() => gbolixLeadIntakeSchema.parse({ externalRequestId: "grq_12345678", externalWorkspaceId: "gws_1", creditAuthorizationId: "auth_123456", label: "Lagos restaurants", inputType: "openstreetmap_discovery", rawContent: "", categoryCode: "restaurants", keywords: ["a", "b", "c", "d", "e", "f", "g", "h", "i"], discovery: { adapterKey: "openstreetmap-pilot-v1", city: "Lagos, Nigeria", limit: 5 } })).toThrow();
  });

  it("forwards signed optional constraints into persisted discovery metadata", () => {
    expect(buildOpenStreetMapRequestMetadata({ adapterKey: "openstreetmap-pilot-v1", city: "Lagos, Nigeria", keywords: ["website", "automation"], requestedLimit: 5 })).toMatchObject({ keywords: ["website", "automation"], attribution: "© OpenStreetMap contributors", cities: ["Lagos, Nigeria"] });
  });

  it("accepts bounded multi-city international discovery", () => {
    const parsed = gbolixLeadIntakeSchema.parse({ externalRequestId: "grq_12345679", externalWorkspaceId: "gws_global", creditAuthorizationId: "auth_123457", label: "Global restaurants", inputType: "openstreetmap_discovery", rawContent: "", categoryCode: "restaurants", discovery: { adapterKey: "openstreetmap-pilot-v1", cities: ["Lagos, Nigeria", "London, United Kingdom", "Toronto, Canada"], country: "global", limit: 75 } });
    expect(parsed.discovery?.cities).toHaveLength(3);
    expect(parsed.discovery?.limit).toBe(75);
  });

  it("rejects more than ten cities in one discovery job", () => {
    const cities = Array.from({ length: 11 }, (_, index) => `City ${index + 1}`);
    expect(() => gbolixLeadIntakeSchema.parse({ externalRequestId: "grq_12345680", externalWorkspaceId: "gws_global", creditAuthorizationId: "auth_123458", label: "Too many cities", inputType: "openstreetmap_discovery", rawContent: "", categoryCode: "restaurants", discovery: { adapterKey: "openstreetmap-pilot-v1", cities, limit: 100 } })).toThrow();
  });
});

describe("global source catalog safeguards", () => {
  it("exposes a worldwide public source and policy-gated Google source", () => {
    delete process.env.GOOGLE_PLACES_SOURCE_APPROVED;
    const catalog = getAdapterCatalog();
    expect(catalog.find(source => source.key === "openstreetmap-pilot-v1")).toMatchObject({ geography: "multi-country", maxCitiesPerJob: 10, maxResultsPerJob: 100, enabled: true });
    expect(catalog.find(source => source.key === "google-places-v1")).toMatchObject({ sourcePolicy: "candidate", enabled: false, requiresApproval: true });
  });

  it("does not enable Google Places until explicit approval is configured", () => {
    process.env.GOOGLE_PLACES_SOURCE_APPROVED = "true";
    const google = getAdapterCatalog().find(source => source.key === "google-places-v1");
    expect(google).toMatchObject({ sourcePolicy: "approved", enabled: true });
    delete process.env.GOOGLE_PLACES_SOURCE_APPROVED;
  });

  it("maps an approved Google Places response into global lead records", async () => {
    process.env.GOOGLE_PLACES_SOURCE_APPROVED = "true";
    process.env.GOOGLE_PLACES_API_KEY = "test-google-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [{ id: "places/abc", displayName: { text: "London Cafe" }, formattedAddress: "1 London Road, London", websiteUri: "https://london.example", internationalPhoneNumber: "+44 20 0000 0000", primaryType: "restaurant", googleMapsUri: "https://maps.google.com/?cid=abc" }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    try {
      const result = await googlePlacesAdapter.discover({ cities: ["London"], country: "GB", categoryCode: "restaurants", limit: 1 });
      expect(result.records[0]).toMatchObject({ businessName: "London Cafe", city: "London", country: "GB", website: "https://london.example" });
      expect(result.provenance[0]).toMatchObject({ sourceUrl: "https://maps.google.com/?cid=abc", retentionClass: "google-places-policy-controlled" });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GOOGLE_PLACES_SOURCE_APPROVED;
      delete process.env.GOOGLE_PLACES_API_KEY;
    }
  });
});

describe("provenance, export access, and rate limits", () => {
  it("defines AI output as non-canonical and unverified", () => {
    expect(aiInferenceObservationPolicy).toEqual({ origin: "ai_inferred", verificationState: "unverified", isCanonical: false });
  });

  it("denies a workspace from downloading another workspace's export", () => {
    const decision = exportAccessDecision({ requestedWorkspaceId: "workspace-a", exportWorkspaceId: "workspace-b", status: "ready", expiresAt: new Date(Date.now() + 60_000) });
    expect(decision).toMatchObject({ allowed: false, action: "denied" });
  });

  it("enforces a bounded fixed-window request limit", () => {
    const limiter = new FixedWindowRateLimiter();
    expect(limiter.consume("operator-1", 2, 60_000, 1).allowed).toBe(true);
    expect(limiter.consume("operator-1", 2, 60_000, 2).allowed).toBe(true);
    expect(limiter.consume("operator-1", 2, 60_000, 3).allowed).toBe(false);
  });
});
