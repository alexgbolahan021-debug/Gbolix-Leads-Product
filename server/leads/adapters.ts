import type { LeadInput } from "@shared/leadContracts";
import { getDiscoverySourceCredential } from "./sourceCredentials";

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
const OVERPASS_ENDPOINTS = [
  process.env.LEADS_OVERPASS_ENDPOINT?.trim(),
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
].filter((endpoint, index, all): endpoint is string => Boolean(endpoint) && all.indexOf(endpoint) === index);
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

export async function resolveCityCoordinates(city: string, country?: string) {
  const cacheKey = cityCacheKey(city, country);
  const cached = cityCache.get(cacheKey);
  if (cached) return cached;

  const waitMs = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimRequestAt));
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastNominatimRequestAt = Date.now();

  const headers = { "User-Agent": "Gbolix-Leads-OpenStreetMap-Pilot/1.1 (support@gbolix.site)", Accept: "application/json" };
  const cityParts = city.split(",").map(part => part.trim()).filter(Boolean);
  const queries = [
    { city: cityParts[0] ?? city, country: (country ?? cityParts.slice(1).join(", ")) || undefined },
    { q: [city, country].filter(Boolean).join(", ") },
  ];
  for (const parameters of queries) {
    const url = new URL(NOMINATIM_ENDPOINT);
    if (parameters.q) url.searchParams.set("q", parameters.q);
    else {
      if (!parameters.city) continue;
      url.searchParams.set("city", parameters.city);
      if (parameters.country) url.searchParams.set("country", parameters.country);
    }
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "1");
    const response = await fetch(url, { headers });
    if (!response.ok) throw pilotError(`city lookup is temporarily unavailable (${response.status})`);
    const body: unknown = await response.json().catch(() => null);
    const matches = Array.isArray(body) ? body as Array<{ lat?: string; lon?: string; address?: { country_code?: string } }> : [];
    const match = matches[0];
    const lat = Number(match?.lat);
    const lon = Number(match?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const result = { lat, lon, countryCode: safeText(match?.address?.country_code)?.toUpperCase() };
      cityCache.set(cacheKey, result);
      return result;
    }
  }
  throw pilotError(`city "${city}" was not found; enter a specific city and country if needed`);
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
  const location = await resolveCityCoordinates(city, request.country);
  const query = `[out:json][timeout:25];(${categoryQuery(request.categoryCode ?? "", location.lat, location.lon)});out center tags ${limit};`;
  let response: Response | null = null;
  let lastFailure = "network error";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const candidate = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Gbolix-Leads-OpenStreetMap/2.1 (support@gbolix.site)" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(25_000),
      });
      if (candidate.ok) { response = candidate; break; }
      lastFailure = `HTTP ${candidate.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "network error";
      try {
        const getUrl = new URL(endpoint);
        getUrl.searchParams.set("data", query);
        const candidate = await fetch(getUrl, { headers: { "User-Agent": "Gbolix-Leads-OpenStreetMap/2.1 (support@gbolix.site)", Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
        if (candidate.ok) { response = candidate; break; }
        lastFailure = `HTTP ${candidate.status}`;
      } catch (fallbackError) {
        lastFailure = fallbackError instanceof Error ? fallbackError.message : lastFailure;
      }
    }
  }
  if (!response) throw pilotError(`candidate lookup could not connect to an available OSM endpoint (${lastFailure})`);
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
const foursquareCategoryQueries: Record<string, string> = { restaurants: "restaurant", "real-estate": "real estate" };
const FOURSQUARE_ENDPOINT = "https://places-api.foursquare.com/places/search";
const FOURSQUARE_API_VERSION = "2025-06-17";
const FOURSQUARE_PAGE_LIMIT = 50;
const FOURSQUARE_MAX_PAGES = 3;

function googleText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function countryCode(value?: string) {
  const normalized = value?.trim();
  return normalized && /^[A-Za-z]{2}$/.test(normalized) ? normalized.toUpperCase() : undefined;
}

async function discoverGooglePlacesCity(request: DiscoveryAdapterRequest, city: string, limit: number) {
  const source = await getDiscoverySourceCredential("google-places-v1");
  const apiKey = source?.apiKey;
  if (!apiKey) throw new Error("Google Places source is not approved or configured in the Leads admin portal.");
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

export type FoursquarePlace = { fsq_place_id?: string; name?: string; latitude?: number; longitude?: number; categories?: Array<{ name?: string; fsq_category_id?: string }>; location?: { formatted_address?: string; address?: string; locality?: string; region?: string; country?: string; postcode?: string }; tel?: string; website?: string; email?: string; description?: string; date_refreshed?: string };

function foursquareCountry(value: unknown, fallback?: string) {
  const candidate = googleText(value) ?? googleText(fallback);
  return candidate && /^[A-Za-z]{2}$/.test(candidate) ? candidate.toUpperCase() : candidate;
}

export function mapFoursquarePlace(place: FoursquarePlace, fallback: { city: string; country?: string }, categoryCode: string): LeadInput | null {
  const businessName = safeText(place.name);
  if (!businessName) return null;
  const location = place.location ?? {};
  return { businessName, website: safeText(place.website), email: safeText(place.email), phone: safeText(place.tel), industry: categoryCode === "restaurants" ? "Restaurant" : categoryCode === "real-estate" ? "Real estate" : categoryCode, description: safeText(place.description ?? place.categories?.[0]?.name), categoryCode, country: foursquareCountry(location.country, fallback.country), region: safeText(location.region), city: safeText(location.locality) ?? fallback.city, address: safeText(location.formatted_address ?? location.address), postalCode: safeText(location.postcode) };
}

export function createFoursquareMockPlaces(count: number, city = "Austin", country = "US"): FoursquarePlace[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({ fsq_place_id: `mock_fsq_${city.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${index + 1}`, name: `${city} Garden Restaurant ${index + 1}`, latitude: 30.2672 + (index % 10) * 0.001, longitude: -97.7431 - (index % 10) * 0.001, categories: [{ name: "Restaurant", fsq_category_id: "mock-restaurant" }], location: { formatted_address: `${100 + index} Congress Avenue, ${city}, ${country}`, locality: city, region: "Texas", country, postcode: `787${String(index % 100).padStart(2, "0")}` }, tel: `+1-512-555-${String(1000 + index).slice(-4)}`, website: `https://mock-${index + 1}.example.test`, description: "Mock Foursquare restaurant record for development pipeline testing", date_refreshed: new Date().toISOString() }));
}

async function discoverFoursquareCity(request: DiscoveryAdapterRequest, city: string, limit: number) {
  const source = await getDiscoverySourceCredential("foursquare-places-v1");
  if (process.env.NODE_ENV !== "production" && (process.env.FOURSQUARE_MOCK_MODE === "true" || source?.developmentFixtureEnabled === true)) {
    const mockPlaces = createFoursquareMockPlaces(limit, city, request.country ?? "US");
    const retrievedAt = new Date().toISOString();
    return { records: mockPlaces.map(place => mapFoursquarePlace(place, { city, country: request.country }, request.categoryCode ?? "restaurants")).filter((record): record is LeadInput => Boolean(record)), provenance: mockPlaces.map(place => ({ sourceUrl: `https://foursquare.com/places/${place.fsq_place_id}`, retrievedAt, retentionClass: "foursquare-development-fixture" })) };
  }
  const apiKey = source?.apiKey;
  if (!apiKey) throw new Error("Foursquare Places source is not approved or configured in the Leads admin portal.");
  const location = await resolveCityCoordinates(city, request.country);
  const records: LeadInput[] = [];
  const provenance: Array<{ sourceUrl?: string; retrievedAt: string; retentionClass: string }> = [];
  let nextUrl: string | undefined;
  for (let page = 0; page < FOURSQUARE_MAX_PAGES && records.length < limit; page += 1) {
    const url = new URL(nextUrl ?? FOURSQUARE_ENDPOINT);
    if (!nextUrl) {
      url.searchParams.set("query", foursquareCategoryQueries[request.categoryCode ?? ""] ?? request.categoryCode ?? "business");
      url.searchParams.set("ll", `${location.lat},${location.lon}`);
      url.searchParams.set("radius", "50000");
      url.searchParams.set("limit", String(Math.min(FOURSQUARE_PAGE_LIMIT, limit - records.length)));
      url.searchParams.set("fields", "fsq_place_id,name,categories,location,latitude,longitude,tel,website,email,description,date_refreshed");
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, "X-Places-Api-Version": FOURSQUARE_API_VERSION, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({})) as { results?: FoursquarePlace[]; message?: string; error?: string };
    if (!response.ok) throw new Error(`Foursquare Places search failed (${response.status}): ${body.message ?? body.error ?? "provider request failed"}`);
    const retrievedAt = new Date().toISOString();
    for (const place of body.results ?? []) {
      if (records.length >= limit) break;
      const record = mapFoursquarePlace(place, { city, country: request.country }, request.categoryCode ?? "restaurants");
      if (!record) continue;
      records.push(record);
      provenance.push({ sourceUrl: place.fsq_place_id ? `https://foursquare.com/places/${encodeURIComponent(place.fsq_place_id)}` : undefined, retrievedAt, retentionClass: "foursquare-policy-controlled" });
    }
    const link = response.headers.get("link");
    nextUrl = link ? (() => { try { return new URL(link, FOURSQUARE_ENDPOINT).toString(); } catch { return undefined; } })() : undefined;
    if (!nextUrl) break;
  }
  return { records, provenance };
}

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

export const foursquarePlacesAdapter: DiscoveryAdapter = {
  key: "foursquare-places-v1",
  label: "Foursquare Places API (official; policy-gated)",
  sourcePolicy: "approved",
  async discover(request) {
    const cities = Array.from(new Set((request.cities ?? []).map(city => city.trim()).filter(Boolean)));
    if (!cities.length) throw new Error("Foursquare Places discovery requires at least one city.");
    if (cities.length > OPENSTREETMAP_MAX_CITIES_PER_JOB) throw new Error(`Foursquare Places discovery supports no more than ${OPENSTREETMAP_MAX_CITIES_PER_JOB} cities per job.`);
    const totalLimit = Math.min(Math.max(1, request.limit), OPENSTREETMAP_GLOBAL_LIMIT);
    const perCityLimit = Math.max(1, Math.ceil(totalLimit / cities.length));
    const records: LeadInput[] = [];
    const provenance: Array<{ sourceUrl?: string; retrievedAt: string; retentionClass: string }> = [];
    for (const city of cities) {
      const remaining = Math.max(0, totalLimit - records.length);
      if (!remaining) break;
      const result = await discoverFoursquareCity(request, city, Math.min(perCityLimit, remaining));
      records.push(...result.records.slice(0, remaining));
      provenance.push(...result.provenance.slice(0, remaining));
    }
    return { adapterKey: "foursquare-places-v1", records: records.slice(0, totalLimit), provenance: provenance.slice(0, totalLimit) };
  },
};

export const googlePlacesAdapter: DiscoveryAdapter = {
  key: "google-places-v1",
  label: "Google Places API (official; policy-gated)",
  sourcePolicy: "approved",
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

export const discoveryAdapterRegistry: DiscoveryAdapter[] = [openStreetMapPilotAdapter, foursquarePlacesAdapter, googlePlacesAdapter];

export function getAdapterCatalog() {
  return [
    { key: "user-provided-v1", label: "User-provided CSV and domains", sourcePolicy: "approved", enabled: true, geography: "worldwide", costClass: "customer_owned" },
    ...discoveryAdapterRegistry.map(adapter => { const isGoogle = adapter.key === "google-places-v1"; const isFoursquare = adapter.key === "foursquare-places-v1"; const policy = (isGoogle && process.env.GOOGLE_PLACES_SOURCE_APPROVED !== "true") || (isFoursquare && !(process.env.NODE_ENV !== "production" && process.env.FOURSQUARE_MOCK_MODE === "true")) ? "candidate" : adapter.sourcePolicy; return { key: adapter.key, label: adapter.label, sourcePolicy: policy, enabled: policy === "approved", geography: "multi-country", costClass: isGoogle || isFoursquare ? "paid_provider" : "public_provider", maxCitiesPerJob: OPENSTREETMAP_MAX_CITIES_PER_JOB, maxResultsPerJob: OPENSTREETMAP_GLOBAL_LIMIT, requiresApproval: isGoogle || isFoursquare, configured: adapter.key === "openstreetmap-pilot-v1" || (isGoogle ? Boolean(process.env.GOOGLE_PLACES_API_KEY) : isFoursquare ? Boolean(process.env.FOURSQUARE_PLACES_API_KEY) || (process.env.NODE_ENV !== "production" && process.env.FOURSQUARE_MOCK_MODE === "true") : false) }; }),
    { key: "licensed-directory-v1", label: "Licensed business directory (optional)", sourcePolicy: "candidate", enabled: false, geography: "provider_defined", costClass: "licensed_provider", requiresApproval: true },
  ];
}
