# Security Policy

## Scope

This Discord AI bot integrates with an operator-controlled Ollama server. The bot does not enable model-generated tool execution; Ollama responses are text only.

## Supported versions

Only the current development state is supported. There is no production deployment or compatibility promise yet.

## Secret and task-data handling

- `OLLAMA_BASE_URL` is an operator-controlled endpoint. Do not set it from user input; do not expose an unauthenticated Ollama API to the public internet. Prefer loopback or a trusted private network.
- Treat prompts and model output as untrusted content. The model is not authorised to execute actions in this release.
- `DISCORD_BOT_TOKEN` is required only when connecting to Discord. Keep it in an untracked `.env` locally or in the deployment platform's secret manager.
- `.env` and other environment files are ignored by Git except `.env.example`. Never commit, log, paste, or include bot tokens in issues, pull requests, screenshots, fixtures, or test output.
- If a token is exposed, revoke and replace it immediately in the Discord Developer Portal, then notify the repository owners.
- Do not add credentials to CI. The checks are intentionally designed to run without secrets.
- `/task submit` stores the request text as plain text in the local task ledger. Users should not submit secrets or sensitive personal information. The default ledger is `.data/tasks.json`; production deployments should mount a persistent, access-controlled volume and set `SHARDS_TASK_STORE_PATH` accordingly.
- The usage ledger at `SHARDS_USAGE_STORE_PATH` (default `.data/usage.json`) stores Discord user/guild IDs, model tags, source type, optional task ID, server-reported token counts/duration, and timestamps—not prompts or generated text. It retains at most the latest 20,000 records and is single-process only.
- The JSON task store is for a single bot process only. Do not point multiple replicas at the same file. It is not tamper-evident, encrypted, or a replacement for a transactional multi-tenant database.
- Task workers must treat request text as untrusted input, use bounded capabilities, and be idempotent. The local Qwen worker performs text inference only; it cannot execute shell commands or write to GitHub. `/ai research` and `/task research` use bounded, read-only public GitHub endpoints. No private-repository access or GitHub write integration is configured.
- `/usage summary` and `/audit task` are requester- and guild-scoped. Usage metrics are best-effort server-reported values; failed or partial model calls may not be recorded. The application currently has no per-user AI rate limit. `/approve`, `/admin`, and policy-decision audit records are not implemented; do not treat task lifecycle events as an approval or authorization system.

## Discord safety

- The bot uses only the `Guilds` gateway intent; do not add privileged intents without review.
- Startup does not register commands. AI/task/usage/audit replies are ephemeral, and users can inspect only their own usage and task data in the same server.
- Command registration is dry-run by default. Bulk registration replaces all commands in the selected scope, so inspect the existing scope first.
- Guild mutation requires `--apply --guild ID`; global mutation additionally requires `--apply --global --confirm-global`.
- Do not authorize or run the live bot against a Discord environment without explicit operator approval.

## Reporting a vulnerability

Do not disclose a suspected secret or vulnerability in a public issue. Contact the Shards inc repository owners through the private project channel with a concise description, impact, safe reproduction steps, affected files or environment, and any mitigation already applied. Please allow the maintainers to investigate before public disclosure.
