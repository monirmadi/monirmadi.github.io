# PSAKSI brain API

This repository hosts the PSAKSI search backend. The existing product frontend is
the 10Web website at https://psaksi.de; do not replace it with this repository's
legacy static page or recreate the website.

Production: `POST https://monirmadi-github-io.onrender.com/api/ask` on the existing
Render service. Supabase provides the existing accounts and private data.
Provider/model secrets remain server-side. No production migration, paid service,
or DNS change is implied by running the checks below.

Use Node.js 22:

```sh
npm test
npm run build
npm run check:live -- --production
```

The live check uses public sample queries and fails when required providers return
no results, unverifiable results, or an outage. It checks the three connected
source families and deterministic continuation; it does **not** establish hosted
AI availability, housing listings, member matching, or chat readiness.

See [the Arabic delivery map and acceptance checklist](docs/PSAKSI-delivery-map-ar.md)
for current evidence, incomplete work, and launch gates. See
[Render operations](docs/RENDER-API.md) for the existing deployment architecture.
