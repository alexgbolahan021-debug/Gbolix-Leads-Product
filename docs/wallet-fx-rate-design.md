# Wallet FX Rate Design Notes

The Wallet will retain the catalog’s approved USD pack prices and create each Paystack transaction in NGN. The order will persist the USD catalog amount, the exact USD-to-NGN conversion rate, the rate provider, the rate retrieval time, the NGN charge amount, and the Paystack reference. This preserves an auditable price snapshot even after the cache refreshes.

The selected storage pattern is a PostgreSQL-backed single-pair cache with a two-hour application freshness window. A checkout may refresh the cache after expiry. It must never use a rate older than 24 hours; it should return a recoverable checkout-unavailable response when no current cache exists and the rate source cannot be reached. NGN checkout amounts should be rounded to the nearest whole naira before conversion into Paystack’s kobo subunit. Existing pending orders retain their original conversion snapshot and cannot be silently repriced.

The candidate rate source is ExchangeRate-API’s USD standard endpoint. Its open endpoint supports caching, accepts `USD` as the base code, and includes a rates map with supported ISO 4217 codes including NGN. The no-key open endpoint updates daily, so a two-hour cache refresh can reduce stale application state but cannot produce a new provider rate more frequently than the provider’s daily publication. For intraday rate refresh, use the provider’s API-key plan or another licensed intraday rate source.

Paystack’s transaction API requires the amount in the subunit of the supported currency and accepts an explicit transaction currency. Paystack’s Nigeria guidance identifies NGN and USD as supported country currencies, while USD requires a qualifying USD domiciliary account. The user confirmed their merchant setup currently supports NGN, so Wallet must initialize the transaction in NGN rather than USD.

## Sources

1. [ExchangeRate-API overview](https://www.exchangerate-api.com/docs/overview)
2. [ExchangeRate-API open endpoint documentation](https://www.exchangerate-api.com/docs/free)
3. [ExchangeRate-API supported currencies](https://www.exchangerate-api.com/docs/supported-currencies)
4. [Paystack Transactions API](https://paystack.com/docs/api/transaction/)
5. [Paystack international-payment currency guidance](https://support.paystack.com/en/articles/2130690)
