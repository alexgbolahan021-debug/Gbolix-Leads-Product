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

const OPENSTREETMAP_PILOT_LIMIT = 25;
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const NOMINATIM_MIN_INTERVAL_MS = 1_100;
let lastNominatimRequestAt = 0;
const cityCache = new Map<string, { lat: number; lon: number; countryCode?: string }>();

type OpenStreetMapElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function pilotError(message: string) {
  return new Error(`OpenStreetMap pilot: ${message}`);
}

function safeText(value?: string) {
  return value?.trim() || undefined;
}

function cityCacheKey(city: string, country?: string) {
  return `${city.trim().toLowerCase()}|${country?.trim().toLowerCase() ?? ""}`;
}

async function geocodePilotCity(city: string, country?: string) {
  const cacheKey = cityCacheKey(city, country);
  const cached = cityCache.get(cacheKey);
  if (cached) return cached;

  const waitMs = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimRequestAt));
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastNominatimRequestAt = Date.now();

  const query = [city, country].filter(Boolean).join(", ");
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, { headers: { "User-Agent": "Gbolix-Leads-OpenStreetMap-Pilot/1.0 (support@gbolix.site)", Accept: "application/json" } });
  if (!response.ok) throw pilotError(`city lookup is temporarily unavailable (${response.status})`);
  const matches = await response.json() as Array<{ lat?: string; lon?: string; address?: { country_code?: string } }>;
  const match = matches[0];
  const lat = Number(match?.lat);
  const lon = Number(match?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw pilotError("city was not found; enter a specific city and country if needed");
  const result = { lat, lon, countryCode: safeText(match?.address?.country_code)?.toUpperCase() };
  cityCache.set(cacheKey, result);
  return result;
}

function categoryQuery(categoryCode: string, lat: number, lon: number) {
  const around = `(around:8000,${lat},${lon})`;
  if (categoryCode === "restaurants") {
    return `nwr["amenity"~"^(restaurant|cafe|fast_food)$"]${around};`;
  }
  if (categoryCode === "real-estate") {
    return `nwr["office"="estate_agent"]${around};nwr["shop"="estate_agent"]${around};`;
  }
  throw pilotError("this pilot currently supports Restaurants and Real Estate only");
}

export function mapOpenStreetMapElement(element: OpenStreetMapElement, fallback: { city: string; country?: string }, categoryCode: string): LeadInput | null {
  const tags = element.tags ?? {};
  const businessName = safeText(tags.name);
  if (!businessName) return null;
  const website = safeText(tags.website ?? tags["contact:website"]);
  const email = safeText(tags.email ?? tags["contact:email"]);
  const phone = safeText(tags.phone ?? tags["contact:phone"]);
  const address = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || undefined;
  return {
    businessName,
    website,
    email,
    phone,
    industry: categoryCode === "restaurants" ? "Restaurant" : "Real estate",
    description: safeText(tags.cuisine ?? tags.description),
    categoryCode,
    country: safeText(tags["addr:country"])?.toUpperCase() ?? fallback.country,
    region: safeText(tags["addr:state"]),
    city: safeText(tags["addr:city"]) ?? fallback.city,
    address,
    postalCode: safeText(tags["addr:postcode"]),
  };
}

export const openStreetMapPilotAdapter: DiscoveryAdapter = {
  key: "openstreetmap-pilot-v1",
  label: "OpenStreetMap pilot discovery",
  sourcePolicy: "approved",
  async discover(request) {
    const city = request.cities?.[0]?.trim();
    if (!city) throw pilotError("a city is required for discovery");
    if ((request.cities?.length ?? 0) !== 1) throw pilotError("only one city can be searched at a time");
    const limit = Math.min(Math.max(1, request.limit), OPENSTREETMAP_PILOT_LIMIT);
    const location = await geocodePilotCity(city, request.country);
    const query = `[out:json][timeout:25];(${categoryQuery(request.categoryCode ?? "", location.lat, location.lon)});out center tags ${limit};`;
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Gbolix-Leads-OpenStreetMap-Pilot/1.0 (support@gbolix.site)" },
      body: new URLSearchParams({ data: query }).toString(),
    });
    if (!response.ok) throw pilotError(`candidate lookup is temporarily unavailable (${response.status})`);
    const body = await response.json() as { elements?: OpenStreetMapElement[] };
    const retrievedAt = new Date().toISOString();
    const elements = (body.elements ?? []).slice(0, limit);
    const records = elements.map(element => mapOpenStreetMapElement(element, { city, country: location.countryCode }, request.categoryCode ?? "")).filter((record): record is LeadInput => Boolean(record));
    return {
      adapterKey: "openstreetmap-pilot-v1",
      records,
      provenance: elements.slice(0, records.length).map(element => ({ sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`, retrievedAt, retentionClass: "openstreetmap-pilot" })),
    };
  },
};

// The registry contains only the tightly bounded pilot. Commercial adapters can replace it without changing the pipeline contract.
export const discoveryAdapterRegistry: DiscoveryAdapter[] = [openStreetMapPilotAdapter];

export function getAdapterCatalog() {
  return [
    { key: "user-provided-v1", label: "User-provided CSV and domains", sourcePolicy: "approved", enabled: true },
    ...discoveryAdapterRegistry.map(adapter => ({ key: adapter.key, label: adapter.label, sourcePolicy: adapter.sourcePolicy, enabled: adapter.sourcePolicy === "approved" })),
  ];
}
