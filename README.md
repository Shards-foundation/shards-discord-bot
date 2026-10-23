# Shards Discord Bot

Private Discord application foundation for **Shards inc**. The application ID is `1562965805413568532`.

> This repository documents a new foundation built from the known command names and requirements. It is **not** a recovered original implementation, and the historical replies are not claimed to be verified exactly.

## Status and safety

- No deployment has been performed.
- No live Discord changes have been made.
- Startup never registers slash commands.
- The bot uses only the `Guilds` gateway intent; no privileged intents are planned.
- Future activation is optional and must be deliberately authorized by an operator.
- There is no deployment workflow, embedded credential, or Docker requirement.

Do not run the live start command until the bot has been authorized in the intended Discord environment and the token has been supplied locally.

## Runtime and package expectations

- Node.js **>= 24.17** (see `.nvmrc`)
- discord.js 14
- JavaScript ESM
- Private package: `UNLICENSED`

## Installation

```sh
npm ci
cp .env.example .env
```

Edit `.env` locally and set `DISCORD_BOT_TOKEN`. Keep `.env` untracked and never paste the token into source, issues, logs, or pull requests. `DISCORD_APPLICATION_ID` defaults to `1562965805413568532` and must be a numeric Discord snowflake when overridden.

## Commands

| Command | Purpose | Network/mutation behavior |
| --- | --- | --- |
| `npm start` | Starts the bot with `node --env-file-if-exists=.env src/index.js` | Connects to Discord; authorize the app first. Startup does not register commands. |
| `npm test` | Runs `node --test` | No secrets required. |
| `npm run check` | Runs `node --check` over source and scripts | No secrets required. |
| `npm run commands:preview` | Runs `node scripts/register-commands.js` | Offline preview; no secrets and no mutation. |
| `npm run commands:register` | Runs the registration script with the local env file | Dry run by default; mutation requires explicit flags. |

The planned commands are:

- `/ping` replies `Pong!` and includes gateway latency.
- `/hello` greets using the username as plain text with `allowedMentions: { parse: [] }` so it does not create mentions.

### Slash-command registration safety

Bulk registration replaces all slash commands in the selected scope. Inspect existing commands before applying changes. The registration script is a dry run by default:

```sh
# Preview without secrets or network mutation
npm run commands:preview

# Apply to one guild only; replace GUILD_ID with the intended ID
npm run commands:register -- --apply --guild GUILD_ID

# Apply globally only after deliberate review and confirmation
npm run commands:register -- --apply --global --confirm-global
```

Global registration can take time to propagate. Do not use `--apply` casually.

## Configuration

Required at runtime:

- `DISCORD_BOT_TOKEN`: bot token; keep it only in a local, untracked `.env`.

Optional:

- `DISCORD_APPLICATION_ID`: numeric application snowflake; defaults to `1562965805413568532`.

The example file is intentionally safe and contains an empty token value.

## License

No permissive license has been chosen. This is a private, unpublished foundation for Shards inc and is marked `UNLICENSED` in the package metadata.
