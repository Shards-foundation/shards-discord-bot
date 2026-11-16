# Shards Mission Control · Discord Activity

A self-contained read-only web Activity deployed to Cloudflare Workers. It is hosted independently of Cue, Hermes, Ollama and Discord bot Gateway sessions.

## Production target

- Worker: `shards-mission-control-activity`
- Cloudflare hostname: `activity.shardsinc.co.uk`
- Discord Application ID: `1562965805413568532` (public identifier, **not** an API credential)
- Discord Developer Portal → Activities → URL Mappings → Root prefix `/`, Target `activity.shardsinc.co.uk` (enter without protocol)
- First launch from an installed app's supported Discord Activity entry point after enabling Activities

## Current functionality

The Activity provides a responsive mission-control interface, public GitHub engineering summaries for a fixed allowlist (`shards-discord-bot`, `Shards-kernel`, `Shards-MCP`), recent public workflow runs, search and filtering, manual refresh and source links. Data is fetched server-side from the GitHub public REST API with short-lived Cloudflare caching. Missing upstream data is labelled unavailable rather than healthy.

Discord Embed SDK 2.5.0 is attempted **only when launched in an iframe/Discord context**, via a pinned URL. `discordSdk.ready()` proves the iframe handshake, not user identity. No OAuth scopes, client secret, bot token, password, privileged Discord intent, interactive bot runtime or task execution are used. In a normal browser, the UI explicitly labels itself as browser preview.

**The Discord portal mapping and Activities toggle are not configurable through the GitHub or Cloudflare connection.** They must be saved in the developer portal for this Discord application after deployment verification.

## Security architecture

- Endpoints: `GET /api/health`, `GET /api/engineering`, `GET /`, `GET /app.js`, `GET /styles.css`.
- `POST` and all non-read methods are rejected.
- Source repositories are fixed in the Worker. No user-specified URL and no upstream secrets.
- GitHub API fetches use strict allowlisted paths, bounded timeout, and 75-second edge caching.
- PR titles and descriptions never reach the browser. UI inserts source-derived text through `textContent`, not `innerHTML`.
- Content Security Policy restricts scripts, styles and framing; no personal data is persisted.
- Agent status is **not connected** until the relevant authenticated health endpoints have been integrated.
- External CDN dependency for Discord SDK remains a production dependency; bundle first-party SDK locally before relying on authenticated Discord features. CSP deliberately allows only jsDelivr for this dependency.

## Test

```sh
node --test activity/test/*.test.mjs
node --check activity/worker.mjs
node --check activity/ui.mjs
node --check activity/client.mjs
```

Cloudflare Worker script upload needs `worker.mjs`, `ui.mjs` and `client.mjs` as separate `application/javascript+module` multipart parts, with `metadata.main_module = "worker.mjs"`. The live custom domain attachment is a separate Cloudflare Worker Domains operation; verify the active deployment and DNS before setting Discord's root mapping.

## Release scope

Version 0.1.0 is a public, unauthenticated **observer**. Never add Discord OAuth exchange, private GitHub access, agent commands, or protected information in the public UI without a threat model, dedicated backend and Kernel-enforced authorisation. Review independent CI, live HTTP responses, TLS and browser embed behavior before public launch.
