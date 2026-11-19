# SheetsChat - Deferred Items

## Post-Launch

- [x] **IP-based rate limiting fallback** — Added origin-based fingerprint rate limiting as secondary layer. Uses `buildFingerprintKey_()` to derive a key from the request origin, rate-limited at 300 req/60s per site (fixed-window buckets; per-session limit is 30 req/60s). Apps Script does not expose client IP, so origin is the best available identifier.
- [x] **Knowledge base read optimization** — Cached `getKnowledgeContext` results in `CacheService` with 5-minute TTL. Cache invalidated on `addKnowledgeEntry` and `deleteKnowledgeEntry`.

## Open

- [ ] **Widget backend in Marketplace (add-on) installs** — The web app runs as the deploying (developer) account with no active document, so `doPost` cannot reach an installing customer's DocumentProperties or KnowledgeBase sheet. The widget only works for a bound/self-deployed copy where the user deploys their own web app. Fixing this needs a per-install identifier in the embed URL plus a server-side store the developer deployment can read (or a "deploy your own web app" flow).
