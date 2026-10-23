# Security Policy

## Scope

This is a private Discord application foundation for Shards inc. The repository is not a deployment system and does not contain production credentials.

## Supported versions

Only the current private development state is supported. There is no public release or compatibility promise yet.

## Secret handling

- `DISCORD_BOT_TOKEN` is required only when connecting to Discord.
- Keep credentials in a local `.env`; `.env` and other environment files are ignored by Git except `.env.example`.
- Never commit, log, paste, or include bot tokens in issues, pull requests, screenshots, fixtures, or test output.
- If a token is exposed, revoke and replace it immediately in the Discord Developer Portal, then notify the repository owners.
- Do not add credentials to CI. The checks are intentionally designed to run without secrets.

## Discord safety

- The bot is planned to use only the `Guilds` gateway intent; do not add privileged intents without review.
- Startup does not register commands.
- Command registration is dry-run by default. Bulk registration replaces all commands in the selected scope, so inspect the existing scope first.
- Guild mutation requires `--apply --guild ID`; global mutation additionally requires `--apply --global --confirm-global`.
- Do not authorize or run the live bot against a Discord environment without explicit operator approval.

## Reporting a vulnerability

Do not disclose a suspected secret or vulnerability in a public issue. Contact the Shards inc repository owners through the private project channel with:

1. A concise description and impact.
2. Reproduction steps or a minimal proof of concept that does not expose credentials.
3. Affected file, command, or environment.
4. Any mitigation already applied.

Please allow the maintainers to investigate before public disclosure. No deployment or live Discord changes are part of this foundation task.
