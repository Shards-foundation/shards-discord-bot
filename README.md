# Shards Discord Bot

A private, safety-first Discord application foundation for **Shards inc**. The current bot provides `/ping` and `/hello`, with offline tests and deliberately guarded slash-command registration.

> **Status:** foundation / development. No production deployment is configured. Startup does not register commands, and no live Discord changes are part of routine development.

## At a glance

| Area | Current state |
| --- | --- |
| Runtime | Node.js `>=24.17`, ESM, discord.js 14 |
| Gateway intents | `Guilds` only; no privileged intents |
| Commands | `/ping`, `/hello` |
| Registration | Offline preview by default; explicit scope and confirmation required to write |
| Tests | Node's built-in test runner; no Discord credentials required |
| Secrets | Local `.env` only; never committed or logged |
| Deployment | Not configured |

## Repository map

```text
src/                 Bot startup, configuration, commands, registration logic
scripts/             Safe operator-facing command tools
test/                Offline unit and safety-boundary tests
.github/workflows/   CI and automated dependency maintenance
```

## Quick start

Prerequisites: Node.js `>=24.17` and npm.

```sh
npm ci
cp .env.example .env
```

Set `DISCORD_BOT_TOKEN` in the local `.env` file only. Never commit the file, paste the token into an issue, or put it in logs. `DISCORD_APPLICATION_ID` is optional and defaults to the Shards application ID `1562965805413568532`.

Do not run the live bot until the application has been deliberately authorized in the intended Discord environment and the token is supplied locally. `npm start` connects to Discord but does not register slash commands.

## Development checks

```sh
npm run check
npm test
npm audit --omit=dev --audit-level=high
```

These checks are designed to run without credentials or Discord network access. GitHub Actions runs the syntax checks and test suite on pushes and pull requests; dependency updates are proposed by Dependabot.

## Commands

- `/ping` — reports the current Discord gateway latency, or `unavailable` until a valid measurement exists.
- `/hello` — greets the invoking username as plain text. Mention parsing is disabled, so user-controlled text cannot trigger mass mentions.

The bot uses the minimum `Guilds` intent. Do not add privileged intents, permissions, or command behavior without reviewing the security and privacy implications.

## Slash-command registration

Registration uses Discord's bulk overwrite endpoint, which replaces **all** commands in the selected scope. Inspect the current scope before applying changes. Preview is offline and safe by default:

```sh
npm run commands:preview
```

To deliberately apply a reviewed change to one test guild:

```sh
npm run commands:register -- --apply --guild GUILD_ID
```

A global overwrite has an additional explicit safeguard and should be rare:

```sh
npm run commands:register -- --apply --global --confirm-global
```

Never run a write command casually or as part of routine CI. The registration CLI intentionally avoids printing raw Discord API errors that could contain sensitive request metadata.

## Configuration reference

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | For live startup / writes | Bot token; store locally in ignored `.env` |
| `DISCORD_APPLICATION_ID` | No | Numeric application snowflake; defaults to `1562965805413568532` |

The checked-in `.env.example` contains no credentials. Rotate a token immediately in the Discord Developer Portal if it is exposed.

## Operational checklist

Before first use, confirm the application and target guild, grant only the permissions needed, keep the bot token outside GitHub and source control, preview command registration, and test guild-scoped changes before considering any global overwrite. There is no deployment workflow or production credential configured in this repository.

## Project status and roadmap

This repository is a foundation, not a claim of feature completeness. Sensible next steps should be driven by actual community needs and reviewed for least privilege, privacy, accessibility, reliability, and maintainability. Avoid adding data collection, privileged intents, external services, or production automation without an explicit product and security decision.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the review checklist and [SECURITY.md](SECURITY.md) for credential handling and vulnerability reporting. This is a private, unpublished project with no permissive license (`UNLICENSED`).
