# Security Policy

## Scope

This is a private Discord application for Shards inc. A non-root Docker image is provided, but hosting, production credentials, a task executor, and an AI provider are not configured.

## Supported versions

Only the current private development state is supported. There is no public release or compatibility promise yet.

## Secret and task-data handling

- `DISCORD_BOT_TOKEN` is required only when connecting to Discord. Keep it in an untracked `.env` locally or in the deployment platform's secret manager.
- `.env` and other environment files are ignored by Git except `.env.example`. Never commit, log, paste, or include bot tokens in issues, pull requests, screenshots, fixtures, or test output.
- If a token is exposed, revoke and replace it immediately in the Discord Developer Portal, then notify the repository owners.
- Do not add credentials to CI. The checks are intentionally designed to run without secrets.
- `/task submit` stores the request text as plain text in the local task ledger. Users should not submit secrets or sensitive personal information. The default ledger is `.data/tasks.json`; production deployments should mount a persistent, access-controlled volume and set `SHARDS_TASK_STORE_PATH` accordingly.
- The JSON task store is for a single bot process only. Do not point multiple replicas at the same file. It is not tamper-evident, encrypted, or a replacement for a transactional multi-tenant database.
- Task workers must treat request text as untrusted input, use bounded capabilities, and be idempotent. No executor is currently configured; queued requests are stored but not processed.

## Discord safety

- The bot uses only the `Guilds` gateway intent; do not add privileged intents without review.
- Startup does not register commands. `/task` responses are ephemeral, and users can inspect or cancel only their own requests in the same server.
- Command registration is dry-run by default. Bulk registration replaces all commands in the selected scope, so inspect the existing scope first.
- Guild mutation requires `--apply --guild ID`; global mutation additionally requires `--apply --global --confirm-global`.
- Do not authorize or run the live bot against a Discord environment without explicit operator approval.

## Reporting a vulnerability

Do not disclose a suspected secret or vulnerability in a public issue. Contact the Shards inc repository owners through the private project channel with a concise description, impact, safe reproduction steps, affected files or environment, and any mitigation already applied. Please allow the maintainers to investigate before public disclosure.
