# PSAKSI Brain API on Render

Native Node.js Web Service; no Docker, packages to install, credentials or database
migrations. Repository root. Build: `node scripts/check-api-build.cjs`. Start: `node server/public-api.cjs`.
Health check: `/healthz`. The Node engine is constrained to version 22.
Render's `PORT` takes precedence over `PSAKSI_PUBLIC_PORT`; host defaults to
`0.0.0.0`. Local port without either variable: 8787.

Required environment variables: none to enter manually (Render supplies PORT).
Optional: NODE_VERSION, PSAKSI_PUBLIC_ALLOWED_ORIGINS, PSAKSI_OLLAMA_ENABLED,
PSAKSI_PUBLIC_HOST, PSAKSI_PUBLIC_PORT. Keep the default public host on Render.
Default exact CORS origins are https://preview.psaksi.de and
https://relaxing-bird.10web.cloud. OPTIONS allows POST and Content-Type only.
No cookies, wildcard origin, browser API key or Supabase login is required.

POST /api/ask retains the version-1 contract. Send JSON with message, optional
conversationId and locale, and publicSearchConsent:true only after showing and
acknowledging the public-search disclosure. The brain determines provider routing.
Disclosure: PSAKSI interprets the request and sends only necessary public search
fields to connected sources. Private or uncertain sharing is blocked. This does
not authorize saving, monitoring or contacting anyone.

Responses retain conversationId, status, phase, message, resultType, results,
refinements, canRefine, expiresAt and error. Status can be results, clarification,
no_result, provider_unavailable, unsupported or error. Source-derived results
retain provenance; there are no demo results or invented verification claims.
Show searching while the synchronous request is pending. Render all source strings
as text. API/transport errors expose safe codes, never stack traces or credentials.

Ollama is disabled by default, including on Render. Existing Photon, BVG and
GovData Fast Paths still use their real provider implementations and privacy gates.
When Ollama is disabled, requests requiring semantic fallback return HTTP 200
with status unsupported and explicit guidance, without dropping user conditions
or contacting providers. When explicitly enabled but unavailable, genuine model
failures still return HTTP 503 temporarily_unavailable.
No external paid model or substitute results are used. If an operator explicitly
enables PSAKSI_OLLAMA_ENABLED, the existing model qwen2.5-coder:7b-instruct must be
available at loopback 127.0.0.1:11434. Unreachable calls fail safely, bounded to
three seconds per model call and the overall search deadline. This deployment
neither provisions nor installs Ollama.

Health is process liveness only; it does not promise model/provider availability.
Run one service instance: conversations and rate limits are process-local.
Context is origin-bound, expires after ten minutes, and permits at most six retained
turns and 2,000 combined characters. Keep the ID only in page memory; do not log it
or place it in URLs. Restarting loses context; handle conversation_expired by asking
for a new search. Concurrent follow-ups are rejected rather than overwriting state.

CORS is not bot protection. Built-in limits remain 20 requests/min per socket peer,
120 globally, 200 conversations and two active searches. Proxy requests may share
a peer bucket; forwarded IP headers are intentionally untrusted. Apply edge abuse
protection separately before broader traffic. Do not log request bodies or IDs.
The API reads no environment file, serves no static files and exposes no auth,
Watch, messaging, private matching or write endpoints. Never publish .env files.

Verification: `npm test` is offline; `npm run check:live` explicitly performs only
public, read-only provider queries. No Render/DNS/10Web/Supabase changes are part
of this repository preparation. Recommended region: Frankfurt, Germany.
