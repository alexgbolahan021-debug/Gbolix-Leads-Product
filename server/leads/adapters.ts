import type { LeadInput } from "@shared/leadContracts";

export type DiscoveryAdapterRequest = {
  country?: string;
  regions?: string[];
  cities?: string[];
  categoryCode?: string;
  keywords?: string[];
  limit: number;
};

export type DiscoveryAdapterResult = {
  adapterKey: string;
  records: LeadInput[];
  provenance: Array<{ sourceUrl?: string; retrievedAt: string; retentionClass: string }>;
};

export interface DiscoveryAdapter {
  key: string;
  label: string;
  sourcePolicy: "approved" | "candidate" | "disabled";
  discover(request: DiscoveryAdapterRequest): Promise<DiscoveryAdapterResult>;
}

// Providers are intentionally not enabled in V1. The registry gives later connectors a controlled, policy-aware extension point.
export const discoveryAdapterRegistry: DiscoveryAdapter[] = [];

export function getAdapterCatalog() {
  return [
    { key: "user-provided-v1", label: "User-provided CSV and domains", sourcePolicy: "approved", enabled: true },
    ...discoveryAdapterRegistry.map(adapter => ({ key: adapter.key, label: adapter.label, sourcePolicy: adapter.sourcePolicy, enabled: adapter.sourcePolicy === "approved" })),
  ];
}
