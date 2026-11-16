# Shards Mission Control · Discord Activity

A self-contained read-only web Activity deployed to Cloudflare Workers. It is hosted independently of Cue, Hermes, Ollama and Discord bot Gateway sessions.

## Production target

- Worker: `shards-mission-control-activity`
- Cloudflare hostname: `activity.shardsinc.co.uk`
- Discord Application ID: `1562965805413568532` (public identifier, **not** an API credential)
- Discord Developer Portal → Activities → URL Mappings → Root prefix `/`, Target `activity.shardsinc.co.uk` (enter without protocol)
- First launch from an installed app's supported Discord Activity entry point after enabling Activities

## Current functionality

The Activity provides a responsive mission-control interface, public GitHub engineering summaries for a fixed allowlist (`shards-discord-bot`, `Shards-kernel`, `Shards-MCP`), recent public
workflow runs, search and filtering, manual refresh and source links. Data is fetched server-side from the GitHub public REST API with 60-minute shared KV and Cloudflare upstream caching.
Missing upstream data is labelled unavailable rather than healthy. Public metrics may be at least 60 minutes old if stale fallback is in effect, otherwise up to 60 minutes stale; the UI
discloses this.

Discord Embed SDK 2.5.0 is attempted **only when launched in an iframe/Discord context**, via a pinned v2.5.0 SDK bundle served from the same-origin Cloudflare Workers KV asset.
`discordSdk.ready()` proves the iframe handshake, not user identity. No OAuth scopes, client secret, bot token, password, privileged Discord intent, interactive bot runtime or task execution
are used. In a normal browser, the UI explicitly labels itself as browser preview.

**The Discord portal mapping and Activities toggle are not configurable through the GitHub or Cloudflare connection.** They must be saved in the developer portal for this Discord application
after deployment verification.

## Security architecture

- Endpoints: `GET /api/health`, `GET /api/engineering`, `GET /`, `GET /app.js`, `GET /styles.css`.
- `POST` and all non-read methods are rejected.
- Source repositories are fixed in the Worker. No user-specified URL and no upstream secrets.
- GitHub API fetches use strict allowlisted paths, bounded timeouts, one-hour shared KV caching and one-hour upstream edge caching.
- PR titles and descriptions never reach the browser. UI inserts source-derived text through `textContent`, not `innerHTML`.
- Content Security Policy restricts scripts, styles and framing; no personal data is persisted.
- Agent status is **not connected** until the relevant authenticated health endpoints have been integrated.
-  The official Discord SDK v2.5.0 is built with esbuild as a self-contained browser module, committed at activity/vendor/discord-sdk.mjs, and SHA-256 verified before it is placed into the
  same Workers KV namespace under the independent key discord-sdk-v250. The Worker serves that immutable asset at /sdk.js. No client-side or runtime third-party CDN proxy is used; unknown
  /npm/* paths return 404. CSP permits same-origin scripts only.

## Free-tier global cache

The Worker binds to an independent Cloudflare Workers KV namespace named `shards-mission-control-public-cache` as `ENGINEERING_CACHE`. That namespace also holds the vetted public Discord SDK
bundle under a separate key. This stores only public GitHub metadata for up to one day, refreshes successful snapshots after one hour and retries unavailable upstream data after three
minutes. It uses the free KV request/write allowance rather than an always-on compute instance. It does not collect Discord member data or model prompts. Cache errors are handled as
failures, not proof of GitHub health. When a previous valid snapshot exists and the upstream fails, the API sets `serving_stale: true` and retains its original `fetched_at`.

## Test

```sh
node --test activity/test/*.test.mjs
node --check activity/worker.mjs
node --check activity/ui.mjs
node --check activity/client.mjs
```

Cloudflare Worker script upload needs `worker.mjs`, `ui.mjs` and `client.mjs` as separate `application/javascript+module` multipart parts, with `metadata.main_module = "worker.mjs"`. On each
release, upload the pinned SDK artifact from the GitHub source to Workers KV, verify its exact SHA-256, then update the Worker with the `ENGINEERING_CACHE` binding preserved. Verify the
active deployment, HTTPS, and `/sdk.js` before setting Discord's root mapping. The custom domain is attached separately through Cloudflare Worker Domains.

## Release scope

Version 0.1.0 is a public, unauthenticated **observer**. The Asset builder is available through `.github/workflows/activity-sdk-asset.yml` and must use its fixed package version; changing it
requires reviewing the package and expected SHA. Never add Discord OAuth exchange, private GitHub access, agent commands, or protected information in the public UI without a threat model,
dedicated backend and Kernel-enforced authorisation. Review independent CI, live HTTP responses, TLS and browser embed behavior before public launch.
