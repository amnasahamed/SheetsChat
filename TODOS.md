# SheetsChat - Deferred Items

## Post-Launch

- [x] **IP-based rate limiting fallback** — Added origin-based fingerprint rate limiting as secondary layer. Uses `buildFingerprintKey_()` to derive a key from the request origin, rate-limited at 60 req/120s. Apps Script does not expose client IP, so origin is the best available identifier.
- [x] **Knowledge base read optimization** — Cached `getKnowledgeContext` results in `CacheService` with 5-minute TTL. Cache invalidated on `addKnowledgeEntry` and `deleteKnowledgeEntry`.
