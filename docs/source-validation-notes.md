# Candidate geography and source-validation notes

## Current decision

The United States remains a launch candidate only. It is not yet the fixed launch geography because no approved source list, credentials, contracts, or benchmark dataset has been provided.

## Verified representative sources

| Source | What official documentation confirms | Relevance to Gbolix Leads | What remains unverified |
|---|---|---|---|
| Yelp Places API | Official documentation describes business search by keyword, category, and location, plus business matching and business details containing fields such as name, address, phone, categories, hours, ratings, and review excerpts. It references API terms, display requirements, and rate limits. | Potential discovery and matching source for selected categories and locations. | Whether the intended Gbolix Leads storage, export, enrichment, and commercial workflow are permitted under the account’s current plan and API terms; email and website coverage must be benchmarked. |
| Foursquare Places API | Official documentation describes global POI data and a Places API for location context, with separate documentation for business listings and data products. | Potential broad geographic discovery source; may be useful for normalized POI identity and category/location coverage. | Exact fields, US category coverage, plan-level retention/export rights, attribution requirements, and whether the proposed lead-intelligence use is permitted under the selected agreement. |
| Google Places API | Official policy documentation states that Places content must not be pre-fetched, cached, or stored beyond specified exceptions, while place IDs are exempt from caching restrictions. | Not suitable as the default durable lead warehouse without a policy-specific design and legal review. | Exact permitted use for each required field, retention behavior, attribution, and whether any proposed feature would be a prohibited export or substitute service. |

## Required benchmark before US commitment

The team should create a labeled test set covering representative US cities, states, business categories, business sizes, and urban/rural areas. For each source, run the same search specifications and measure the number of unique businesses, valid business websites, public business emails, usable phones, category precision, location precision, duplicate rate, stale or closed records, and enrichment completion rate.

The benchmark should also record operational metrics: API response latency, error and timeout rate, rate-limit behavior, price per candidate, price per qualified lead, terms governing storage and export, attribution requirements, and the source’s treatment of derived or AI-enriched data.

A source should not be approved merely because it returns many records. It should pass a quality threshold defined in advance, with separate thresholds for discovery coverage, contactability, freshness, and evidence quality.

## Immediate dependency

The actual approved source list is still required from the product owner. Until the source names, contracts, or API plans are supplied, the architecture should implement a provider-neutral adapter interface and a source-policy registry, but should not hard-code the United States as the launch market or commit to a specific provider as the source of truth.

## References

[1]: https://docs.developer.yelp.com/docs/places-intro "Yelp Places API: Getting Started"

[2]: https://docs.foursquare.com/data-products/docs/places-api "Foursquare Places API"

[3]: https://developers.google.com/maps/documentation/places/web-service/policies "Google Maps Platform: Policies and attributions for Places API"
