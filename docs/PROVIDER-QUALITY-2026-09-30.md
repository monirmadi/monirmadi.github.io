# Real provider quality milestone — 2026-09-30

Resumed from c6355cd (main and freshly fetched origin/main matched): semantic representability is separate from provider availability. The existing 10Web → public API connection was preserved. Composite intent resolution remains in place; opt-in people matching, chat and housing inventory remain unavailable rather than simulated.

Changes:
- Source display URLs are separate from retrieval provenance. GovData prefers a supplied HTTPS public page, including legitimate query parameters; known machine endpoints/files and credential-bearing links are excluded. A source-provided CKAN name supplies the public GovData dataset-page fallback. No title-derived slug or external URL fetching is used.
- Result cards no longer fall back to API retrieval URLs. BVG cards without a supported public result permalink have no Open source action; provenance attribution remains. This avoids inventing a journey permalink.
- Punctuation-only public queries fail closed before provider execution.
- Photon validates positive OSM identifiers and suppresses duplicate identities, preserving DE/public-place filters and approximate coordinates.
- BVG rejects disconnected journey legs; snapshot/time uncertainty is preserved.

Validation:
- 32 tests passed, including existing three-provider routing, privacy, composite intent, consent and CORS regression coverage.
- Syntax/import build passed. Runtime used Node 24.19.0 (declared deployment engine remains Node 22).
- Real read-only calls through the local production API handler: Arabic coffee → Berlin continuation 17 Photon results; Café in Berlin 17; Alexanderplatz → Potsdam 3 BVG journeys; bicycle infrastructure Berlin 2 GovData results. Unsupported purchase stayed unsupported. No model API calls were needed.
- Verified GovData /suche/daten/fahrrad-zahlung-zahlstellen returns HTTP 200 HTML, consistent with a live CKAN record's name.

Limits: provider availability and map/catalogue freshness are not guarantees. Supplied page URLs are conservatively classified, not fetched/content-verified. No migration, frontend redesign, secrets or new provider was introduced. Live local checks do not prove a Render deployment has updated.
