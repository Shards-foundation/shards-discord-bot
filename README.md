# Shards Discord Bot

A private, safety-first Discord application for Shards. The first community command pack now includes help, live runtime status, dice rolls, random choice and coin flips alongside ping and hello.

> **Status:** foundation / development. No production deployment is configured. Startup does not register commands, and no live Discord changes are part of routine development.

## At a glance

| Area | Current state |
| --- | --- |
| Runtime | Node.js `>=24.17`, ESM, discord.js 14 |
| Gateway intents | `Guilds` only; no privileged intents |
| Commands | `/ping`, `/hello`, `/help`, `/status`, `/roll`, `/choose`, `/coinflip` |
| Registration | Offline preview by default; explicit scope and confirmation required to write |
| Tests | Node's built-in test runner; no Discord credentials required |
| Secrets | Local `.env` only; never committed or logged |
| Deployment | Not configured |

## Quick start

Prerequisites: Node.js `>=24.17` and npm.

```sh
npm ci
cp .env.example .env
```

Set `DISCORD_BOT_TOKEN` in the local `.env` file only. Never commit the file, paste the token into an issue, or put it in logs. `DISCORD_APPLICATION_ID` is optional and defaults to the Shards application ID `1562965805413568532`.

Do not run the live bot until the application has been deliberately authorized in the intended Discord environment and the token is supplied locally. `npm start` connects to Discord but does not register slash commands.

## Commands

- `/ping` — reports Discord gateway latency, or `unavailable` until a valid measurement exists.
- `/hello` — greets the invoking username as plain text.
- `/help` — lists commands and their purpose.
- `/status` — reports gateway latency, connected server count and process uptime.
- `/roll [sides]` — uses Node's cryptographic random integer generator to roll a die from 2 to 1000 sides; defaults to six.
- `/choose options` — chooses randomly from 2–20 comma-separated options. Inputs are bounded and empty entries are ignored.
- `/coinflip` — returns heads or tails using the same cryptographic random source.

All command replies disable automatic mention parsing. The bot does not read ordinary messages and continues to use only the minimum `Guilds` gateway intent.

## Development checks

```sh
npm run check
npm test
npm audit --omit=dev --audit-level=high
```

These checks are designed to run without credentials or Discord network access. GitHub Actions runs syntax checks and tests on pushes and pull requests; dependency updates are proposed by Dependabot.

## Slash-command registration

Registration uses Discord's bulk overwrite endpoint, which replaces **all** commands in the selected scope. Inspect the current scope before applying changes. Preview is offline and safe by default:

```sh
npm run commands:preview
```

To deliberately apply the reviewed command set to one test guild:

```sh
npm run commands:register -- --apply --guild GUILD_ID
```

A global overwrite has an additional explicit safeguard:

```sh
npm run commands:register -- --apply --global --confirm-global
```

Never run a write command casually or as part of routine CI. No live Discord command registration is included in this change.

## Current limitations and next build stages

This first feature slice is intentionally stateless: it adds no database, message-content intent, third-party AI provider, or privileged permissions. It does not yet execute agent tasks or persist user data. The next substantive platform step should introduce durable task records, explicit per-server authorization, auditable state transitions, cancellation and bounded workers before exposing agent execution in Discord.

## Security and project status

Keep the bot token outside source control and rotate it immediately if exposed. See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md). This is a private, unpublished project with no permissive license (`UNLICENSED`).
