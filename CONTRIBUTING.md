# Contributing

This private repository is a foundation for Shards inc's Discord application. Keep changes small, reviewable, and safe to run offline.

## Before you change anything

1. Use Node.js `>=24.17` and install dependencies with `npm ci`.
2. Read the README and check whether a change can affect Discord permissions, intents, or slash-command registration.
3. Never add tokens, credentials, copied production payloads, or private invite links to the repository.

## Local checks

Run these before opening a change:

```sh
npm run check
npm test
npm audit --omit=dev --audit-level=high
```

These checks should not require Discord credentials. Keep `.env` local and use `.env.example` when documenting configuration names.

## Slash commands

The known commands are `/ping` and `/hello`. Preserve `/hello`'s plain-text greeting behavior with `allowedMentions: { parse: [] }` unless a reviewed requirement changes it.

Command registration is potentially destructive because bulk registration replaces the selected scope. Use the offline preview first, inspect existing commands, and never register globally casually:

```sh
npm run commands:preview
npm run commands:register -- --apply --guild GUILD_ID
npm run commands:register -- --apply --global --confirm-global
```

The final two commands are examples of explicitly authorized operations, not a request to run them. Do not run the live bot or make Discord changes as part of routine review.

## Pull requests

Include:

- What changed and why.
- Which checks were run and their results.
- Any Discord permission, intent, or registration implications.
- Confirmation that no secrets or live Discord changes are included.

Avoid unrelated formatting churn. There is currently no permissive license; the package is private and `UNLICENSED`.
