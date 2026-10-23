# Shards Discord Bot

A private, safety-first Discord application foundation for **Shards inc**. The bot provides basic utility commands, truthful runtime status, a durable task-intake lifecycle, offline tests, and deliberately guarded slash-command registration.

> **Status:** foundation / development. No production deployment is configured. Startup does not register commands, and no live Discord changes are part of routine development.

## At a glance

| Area | Current state |
| --- | --- |
| Runtime | Node.js `>=24.17`, ESM, discord.js 14 |
| Gateway intents | `Guilds` only; no privileged intents |
| Commands | `/ai ask`, `/ai status`, `/ai models`, `/github repo`, `/system status`, `/task submit`, `/task status`, `/task cancel`, community utilities |
| AI inference | Real Ollama `/api/chat` integration using configured Qwen model; no cloud AI key required |
| Task execution | Durable intake ledger; agentic tool execution is not yet enabled |
| Registration | Offline preview by default; explicit scope and confirmation required to write |
| Tests | Node's built-in test runner; no Discord credentials required |
| Secrets | Local `.env` only; never committed or logged |
| Deployment | Docker Compose provided for bot + Ollama; operator supplies Discord token and hardware capacity |

## Repository map

```text
src/                 Bot startup, Ollama client, commands, task lifecycle, registration logic
Dockerfile           Non-root bot container image
compose.yaml          Bot + Ollama service orchestration
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

Set `DISCORD_BOT_TOKEN` in the local `.env` file only. Install [Ollama](https://ollama.com/download) on the host and run `ollama pull qwen3.5:4b`; the model name must match `OLLAMA_MODEL`. If using Docker Compose, the included `ollama-init` service pulls the configured model automatically. Never commit the file, paste the token into an issue, or put it in logs. `DISCORD_APPLICATION_ID` is optional and defaults to the Shards application ID `1562965805413568532`.

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
- `/help` — lists supported commands and clearly states that queued tasks are not executed yet.
- `/roll [sides]` — rolls a die from 2 to 1000 sides, defaulting to six.
- `/choose options` — randomly chooses from 2–20 comma-separated options; the input is bounded and empty entries are ignored.
- `/coinflip` — returns heads or tails.
- `/github repo repository` — looks up a public repository by `owner/name`, returning description, stars, forks, open issues and primary language. The request is fixed to GitHub's public API, uses a five-second timeout, and does not require a token.
- `/ai ask prompt` — runs a real inference request against the configured Ollama model and privately returns the response.
- `/ai status` — checks API reachability and whether the configured model is installed.
- `/ai models` — lists the models available to the configured Ollama server.
- `/system status` — reports the actual Discord ready state, gateway latency, process uptime, and Node.js runtime.
- `/task submit` — stores a bounded request in the durable queue and returns its ID. It does **not** execute the request: no worker or AI provider is configured.
- `/task status` and `/task cancel` — privately inspect or cancel the request you submitted. Only queued tasks can be cancelled.

Task records are written atomically to `SHARDS_TASK_STORE_PATH` (default `.data/tasks.json`) with owner-only file permissions. Requests are stored as plain text: do not submit secrets or sensitive personal information. The current JSON ledger is single-process only; it recovers interrupted `running` tasks to `queued` and records that recovery, up to three attempts before marking the task failed. Worker integrations must be idempotent because a crash can cause a task to be retried. Use a shared transactional database before running multiple bot instances. There is no executor yet, so submitted work stays queued until one is added.

Random utilities use Node's built-in cryptographic random integer generator and add no dependencies. The GitHub command makes a bounded read-only request to the public GitHub API and handles rate limits and timeouts. All command replies disable automatic mention parsing. ### Ollama + Qwen

The bot calls Ollama's `POST /api/chat` endpoint with `stream: false`, a bounded prompt, and a bounded generation length. The default model is `qwen3.5:4b`; override it with `OLLAMA_MODEL` after pulling that model on the Ollama server. Ollama's API is unauthenticated by default, so bind it to localhost or a trusted private network; do not expose port 11434 directly to the public internet.

For a host-installed Ollama server, set `OLLAMA_BASE_URL=http://127.0.0.1:11434`. When the bot runs inside Docker Compose, set it to `http://ollama:11434` (the Compose configuration already does this). Discord and Ollama must both be reachable from the bot's runtime. A model cannot run inside Discord itself; inference occurs on the machine/container hosting Ollama.

The current `/ai` integration is text chat only. It does not yet grant Qwen tool access, run shell commands, modify repositories, browse the web, or execute queued tasks. Those capabilities require separate, permissioned tool adapters and a governed execution worker.

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
| `SHARDS_TASK_STORE_PATH` | No | Durable task ledger file path; defaults to `.data/tasks.json` |

The checked-in `.env.example` contains no credentials. Rotate a token immediately in the Discord Developer Portal if it is exposed.

## Operational checklist

Before first use, confirm the application and target guild, grant only the permissions needed, keep the bot token outside GitHub and source control, preview command registration, and test guild-scoped changes before considering any global overwrite. The Dockerfile provides a non-root production image, but hosting, durable volume provisioning, monitoring, and production credentials are not configured in this repository.

## Project status and roadmap

This repository is a foundation, not a claim of feature completeness. Sensible next steps should be driven by actual community needs and reviewed for least privilege, privacy, accessibility, reliability, and maintainability. Avoid adding data collection, privileged intents, external services, or production automation without an explicit product and security decision.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the review checklist and [SECURITY.md](SECURITY.md) for credential handling and vulnerability reporting. The [Terms of Service](TERMS_OF_SERVICE.md) and [Privacy Policy](PRIVACY_POLICY.md) are **drafts only**: complete their legal-entity, contact, jurisdiction, effective-date, deployment, and retention details and obtain legal review before publishing or relying on them. The project is licensed under MIT. The GitHub repository must be made public by an authorised maintainer before it is publicly discoverable as an open-source repository.
