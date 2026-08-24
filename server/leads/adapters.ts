import type { LeadInput } from "@shared/leadContracts";

export type DiscoveryAdapterRequest = {
  country?: string;
  regions?: string[];
  cities?: string[];
  categoryCode?: string;
  keywords?: string[];
  limit: number;
  sourcePolicy?: { allowPublicWeb?: boolean; maxProviderSpend?: number; allowedCountries?: string[] };
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
const OPENSTREETMAP_GLOBAL_LIMIT = 100;
const OPENSTREETMAP_MAX_CITIES_PER_JOB = 10;
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

async function discoverOpenStreetMapCity(request: DiscoveryAdapterRequest, city: string, limit: number) {
  const location = await geocodePilotCity(city, request.country);
  const query = `[out:json][timeout:25];(${categoryQuery(request.categoryCode ?? "", location.lat, location.lon)});out center tags ${limit};`;
  let response: Response;
  try {
    response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Gbolix-Leads-OpenStreetMap/2.0 (support@gbolix.site)" },
      body: new URLSearchParams({ data: query }).toString(),
    });
  } catch (error) {
    throw pilotError(`candidate lookup could not connect (${error instanceof Error ? error.message : "network error"})`);
  }
  if (!response.ok) throw pilotError(`candidate lookup is temporarily unavailable (${response.status})`);
  const body = await response.json() as { elements?: OpenStreetMapElement[] };
  const retrievedAt = new Date().toISOString();
  const elements = (body.elements ?? []).slice(0, limit);
  const records = elements.map(element => mapOpenStreetMapElement(element, { city, country: location.countryCode }, request.categoryCode ?? "")).filter((record): record is LeadInput => Boolean(record));
  return {
    records,
    provenance: elements.slice(0, records.length).map(element => ({ sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`, retrievedAt, retentionClass: "openstreetmap-public" })),
  };
}

const googleCategoryTypes: Record<string, string> = { restaurants: "restaurant", "real-estate": "real_estate_agency" };

function googleText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function countryCode(value?: string) {
  const normalized = value?.trim();
  return normalized && /^[A-Za-z]{2}$/.test(normalized) ? normalized.toUpperCase() : undefined;
}

async function discoverGooglePlacesCity(request: DiscoveryAdapterRequest, city: string, limit: number) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) throw new Error("Google Places source is not configured. Add GOOGLE_PLACES_API_KEY on the Leads engine.");
  const records: LeadInput[] = [];
  const provenance: Array<{ sourceUrl?: string; retrievedAt: string; retentionClass: string }> = [];
  let pageToken: string | undefined;
  let pages = 0;
  while (records.length < limit && pages < 3) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.nationalPhoneNumber,places.primaryType,places.googleMapsUri,nextPageToken" },
      body: JSON.stringify({ textQuery: `${request.categoryCode ?? "businesses"} in ${city}${request.country ? `, ${request.country}` : ""}`, includedType: googleCategoryTypes[request.categoryCode ?? ""], pageSize: Math.min(20, Math.max(1, limit - records.length)), pageToken }),
    });
    const body = await response.json().catch(() => ({})) as { places?: Array<Record<string, unknown>>; nextPageToken?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(`Google Places search failed (${response.status}): ${body.error?.message ?? "provider request failed"}`);
    const retrievedAt = new Date().toISOString();
    for (const place of body.places ?? []) {
      const displayName = safeText(googleText(safeJson(place.displayName).text));
      if (!displayName || records.length >= limit) continue;
      const address = googleText(place.formattedAddress);
      records.push({ businessName: displayName, website: googleText(place.websiteUri), email: undefined, phone: googleText(place.internationalPhoneNumber ?? place.nationalPhoneNumber), industry: request.categoryCode === "restaurants" ? "Restaurant" : request.categoryCode === "real-estate" ? "Real estate" : request.categoryCode, description: googleText(place.primaryType), categoryCode: request.categoryCode, country: countryCode(request.country), city, address });
      provenance.push({ sourceUrl: googleText(place.googleMapsUri) ?? (googleText(place.id) ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(String(place.id).replace(/^places\//, ""))}` : undefined), retrievedAt, retentionClass: "google-places-policy-controlled" });
    }
    pageToken = googleText(body.nextPageToken);
    pages += 1;
    if (!pageToken) break;
  }
  return { records, provenance };
}

function safeJson(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

export const openStreetMapPilotAdapter: DiscoveryAdapter = {
  key: "openstreetmap-pilot-v1",
  label: "OpenStreetMap global public discovery (bounded)",
  sourcePolicy: "approved",
  async discover(request) {
    const cities = Array.from(new Set((request.cities ?? []).map(city => city.trim()).filter(Boolean)));
    if (!cities.length) throw pilotError("at least one city is required for discovery");
    if (cities.length > OPENSTREETMAP_MAX_CITIES_PER_JOB) throw pilotError(`no more than ${OPENSTREETMAP_MAX_CITIES_PER_JOB} cities can be searched in one job`);
    const totalLimit = Math.min(Math.max(1, request.limit), OPENSTREETMAP_GLOBAL_LIMIT);
    const perCityLimit = Math.max(1, Math.ceil(totalLimit / cities.length));
    const records: LeadInput[] = [];
    const provenance: Array<{ sourceUrl?: string; retrievedAt: string; retentionClass: string }> = [];
    for (const city of cities) {
      const remaining = Math.max(0, totalLimit - records.length);
      if (!remaining) break;
      const result = await discoverOpenStreetMapCity(request, city, Math.min(perCityLimit, remaining));
      records.push(...result.records.slice(0, remaining));
      provenance.push(...result.provenance.slice(0, remaining));
    }
    return { adapterKey: "openstreetmap-pilot-v1", records: records.slice(0, totalLimit), provenance: provenance.slice(0, totalLimit) };
  },
};

export const googlePlacesAdapter: DiscoveryAdapter = {
  key: "google-places-v1",
  label: "Google Places API (official; policy-gated)",
  get sourcePolicy() { return process.env.GOOGLE_PLACES_SOURCE_APPROVED === "true" ? "approved" : "candidate"; },
  async discover(request) {
    const cities = Array.from(new Set((request.cities ?? []).map(city => city.trim()).filter(Boolean)));
    if (!cities.length) throw new Error("Google Places discovery requires at least one city.");
    if (cities.length > OPENSTREETMAP_MAX_CITIES_PER_JOB) throw new Error(`Google Places discovery supports no more than ${OPENSTREETMAP_MAX_CITIES_PER_JOB} cities per job.`);
    const totalLimit = Math.min(Math.max(1, request.limit), OPENSTREETMAP_GLOBAL_LIMIT);
    const perCityLimit = Math.max(1, Math.ceil(totalLimit / cities.length));
    const records: LeadInput[] = [];
    const provenance: Array<{ sourceUrl?: string; retrievedAt: string; retentionClass: string }> = [];
    for (const city of cities) {
      const remaining = Math.max(0, totalLimit - records.length);
      if (!remaining) break;
      const result = await discoverGooglePlacesCity(request, city, Math.min(perCityLimit, remaining));
      records.push(...result.records.slice(0, remaining));
      provenance.push(...result.provenance.slice(0, remaining));
    }
    return { adapterKey: "google-places-v1", records, provenance };
  },
};

export const discoveryAdapterRegistry: DiscoveryAdapter[] = [openStreetMapPilotAdapter, googlePlacesAdapter];

export function getAdapterCatalog() {
  return [
    { key: "user-provided-v1", label: "User-provided CSV and domains", sourcePolicy: "approved", enabled: true, geography: "worldwide", costClass: "customer_owned" },
    ...discoveryAdapterRegistry.map(adapter => ({ key: adapter.key, label: adapter.label, sourcePolicy: adapter.sourcePolicy, enabled: adapter.sourcePolicy === "approved", geography: "multi-country", costClass: adapter.key === "google-places-v1" ? "paid_provider" : "public_provider", maxCitiesPerJob: OPENSTREETMAP_MAX_CITIES_PER_JOB, maxResultsPerJob: OPENSTREETMAP_GLOBAL_LIMIT, requiresApproval: adapter.key === "google-places-v1", configured: adapter.key !== "google-places-v1" || Boolean(process.env.GOOGLE_PLACES_API_KEY) })),
    { key: "licensed-directory-v1", label: "Licensed business directory (optional)", sourcePolicy: "candidate", enabled: false, geography: "provider_defined", costClass: "licensed_provider", requiresApproval: true },
  ];
}
