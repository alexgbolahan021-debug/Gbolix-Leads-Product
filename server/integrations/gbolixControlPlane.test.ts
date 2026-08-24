import { createHmac } from "crypto";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ingestProviderDiscovery: vi.fn(), discover: vi.fn(), listPendingIntegrationEvents: vi.fn(), markIntegrationEventDelivery: vi.fn() }));

vi.mock("../leadDb", () => ({
  authorizeWorkspaceExportDownload: vi.fn(),
  createWorkspaceRequestExport: vi.fn(),
  getWorkspaceRequestResults: vi.fn(),
  ingestProviderDiscovery: mocks.ingestProviderDiscovery,
  ingestUserLeads: vi.fn(),
  listPendingIntegrationEvents: mocks.listPendingIntegrationEvents,
  markIntegrationEventDelivery: mocks.markIntegrationEventDelivery,
}));

vi.mock("../leads/adapters", () => ({
  discoveryAdapterRegistry: [{ key: "openstreetmap-pilot-v1", sourcePolicy: "approved", discover: mocks.discover }],
}));

vi.mock("../leads/integration", () => ({ getIntegrationSecret: () => "control-plane-route-test-secret" }));

import { registerGbolixControlPlaneRoutes } from "./gbolixControlPlane";

afterEach(() => {
  mocks.ingestProviderDiscovery.mockReset();
  mocks.discover.mockReset();
  mocks.listPendingIntegrationEvents.mockReset();
  mocks.markIntegrationEventDelivery.mockReset();
  vi.unstubAllGlobals();
  delete process.env.GBOLIX_CONTROL_PLANE_CALLBACK_URL;
  delete process.env.GBOLIX_CONTROL_PLANE_CALLBACK_SECRET;
});

describe("signed discovery intake", () => {
  it("forwards confirmed chat constraints into the discovery persistence metadata", async () => {
    mocks.discover.mockResolvedValue({ adapterKey: "openstreetmap-pilot-v1", records: [], provenance: [] });
    mocks.ingestProviderDiscovery.mockResolvedValue({ jobId: "job_1", createdCount: 0, duplicateCount: 0 });
    const payload = { externalRequestId: "grq_12345678", externalWorkspaceId: "gws_1", creditAuthorizationId: "auth_123456", label: "Lagos restaurants", inputType: "openstreetmap_discovery", rawContent: "", categoryCode: "restaurants", keywords: ["website", "automation"], discovery: { adapterKey: "openstreetmap-pilot-v1", city: "Lagos, Nigeria", limit: 5 } };
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", "control-plane-route-test-secret").update(`${timestamp}.${JSON.stringify(payload)}`).digest("hex");
    const app = express();
    app.use(express.json());
    registerGbolixControlPlaneRoutes(app);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to start test server");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/integrations/gbolix/leads/ingest`, { method: "POST", headers: { "Content-Type": "application/json", "X-Gbolix-Timestamp": timestamp, "X-Gbolix-Signature": signature }, body: JSON.stringify(payload) });
      expect(response.status).toBe(202);
      expect(mocks.ingestProviderDiscovery).toHaveBeenCalledWith(expect.objectContaining({ adapterKey: "openstreetmap-pilot-v1", requestMetadata: expect.objectContaining({ keywords: ["website", "automation"], city: "Lagos, Nigeria", cities: ["Lagos, Nigeria"], requestedLimit: 5 }) }));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("returns accepted when callback delivery is refused and leaves the event pending", async () => {
    mocks.discover.mockResolvedValue({ adapterKey: "openstreetmap-pilot-v1", records: [], provenance: [] });
    mocks.ingestProviderDiscovery.mockResolvedValue({ jobId: "job_2", integrationEventId: "event_2", createdCount: 2, duplicateCount: 0 });
    mocks.listPendingIntegrationEvents.mockResolvedValue([{ id: "event_2", externalRequestId: "grq_22345678", leadJobId: "job_2", creditAuthorizationId: "auth_223456", payload: { newQualifiedLeads: 2, existingDuplicates: 0 } }]);
    mocks.markIntegrationEventDelivery.mockResolvedValue({});
    process.env.GBOLIX_CONTROL_PLANE_CALLBACK_URL = "http://127.0.0.1:1/api/callback";
    process.env.GBOLIX_CONTROL_PLANE_CALLBACK_SECRET = "callback-test-secret";
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes("127.0.0.1:1") ? Promise.reject(new Error("fetch failed")) : realFetch(input, init)));
    const payload = { externalRequestId: "grq_22345678", externalWorkspaceId: "gws_1", creditAuthorizationId: "auth_223456", label: "London restaurants", inputType: "openstreetmap_discovery", rawContent: "", categoryCode: "restaurants", keywords: [], discovery: { adapterKey: "openstreetmap-pilot-v1", city: "London, United Kingdom", limit: 5 } };
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", "control-plane-route-test-secret").update(`${timestamp}.${JSON.stringify(payload)}`).digest("hex");
    const app = express();
    app.use(express.json());
    registerGbolixControlPlaneRoutes(app);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to start test server");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/integrations/gbolix/leads/ingest`, { method: "POST", headers: { "Content-Type": "application/json", "X-Gbolix-Timestamp": timestamp, "X-Gbolix-Signature": signature }, body: JSON.stringify(payload) });
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual(expect.objectContaining({ accepted: true, callback: { delivered: false, reason: "callback_fetch_failed" } }));
      expect(mocks.markIntegrationEventDelivery).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event_2", state: "pending", errorCode: "CALLBACK_FETCH_FAILED" }));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
