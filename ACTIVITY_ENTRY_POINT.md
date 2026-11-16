# Non-destructive Discord Activity Entry Point repair

## Why

The **Shards inc** application has Activities enabled and a deployed Activity at
`activity.shardsinc.co.uk`, but Discord Developer Portal reports a missing Entry
Point command. The App Launcher therefore does not list a launchable Activity.
The application also has an independently hosted Hermes/Cue command registry,
including `/sethome`, `/status` and `/help`.

**All existing commands must be preserved.** Discord's normal application
command bulk registration (`PUT`) replaces an entire command scope and is
**not suitable** here. Never run `npm run commands:register` to repair
this Entry Point.

## Supported safe operations

```sh
npm run activity:entry:preview
npm run activity:entry:check
npm run activity:entry:add
```

- `preview`: offline inspection of the proposed command. Requires no credentials.
- `check`: authenticated, read-only `GET` of global application commands.
- `add`: **explicit**, authenticated add-only operation. Reads the entire
  global registry twice, refuses conflicting names, and uses exactly one
  `POST` to `/applications/{application.id}/commands` only when no Entry Point
  exists. If any existing type-4 Entry Point is present, it does **not** modify it.

Discord treats `POST` with an existing command name and type as an upsert,
so the tool refuses a name conflict and rechecks immediately before POST.
No delete, patch, or bulk PUT endpoints are implemented. A concurrent
external edit between the last GET and POST is not fully preventable by the
Discord API, so keep other registration processes idle during add-only execution.

## Credentials and runtime

The operator must provide `DISCORD_BOT_TOKEN` through a local ignored
`.env` or approved secret store on the machine executing the CLI.
Never paste the token into a chat, pull request, issue, log or repository file.
The application ID defaults to `1562965805413568532`.

No live call has been performed just by merging this code. The GitHub repository
does not contain a bot token and ordinary CI does not register commands.
Run only after reviewing the `--check` output. For command repair,
do not use a Cloudflare Worker or the Activity URL as an Interactions Endpoint.

## Entry Point contract

- Name: `launch`
- Type: `4` (PRIMARY_ENTRY_POINT)
- Handler: `2` (DISCORD_LAUNCH_ACTIVITY)
- Installation: `[0]` (guild)
- Context: `[0]` (guild)

Discord handles launch itself; Hermes does not need to reply to this Entry
Point. This does not repair Hermes's missing command responses.

This Entry Point is restricted to guilds (contexts [0]), not DMs.
Test it in a small private development server with fewer than 25 members
while the application remains unverified. The existing 402-member server
is not a suitable unverified Activity test environment.

Do not modify or replace previously registered commands to enable an Activity.

Source: https://docs.discord.com/developers/interactions/application-commands
