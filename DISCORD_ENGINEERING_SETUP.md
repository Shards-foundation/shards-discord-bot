# Discord engineering notifications (opt-in)

This workflow is scoped to this repository's PR opened/reopened/closed, published release, and failed completed runs from the `CI` workflow. It does **not** connect live agent tasks or other Shards repos. It is only active after merge to the default branch and configuration of a repository Actions secret named `SHARDS_DISCORD_ENGINEERING_WEBHOOK`.

1. Verify `#shards-engineering` visibility and intended readership. Do not send private repository metadata into a public Discord channel.
2. In Discord, create an incoming webhook scoped **only** to `#shards-engineering`. Keep its URL secret; do not place it in source code, logs or a PR.
3. In the GitHub repository, set Actions secret `SHARDS_DISCORD_ENGINEERING_WEBHOOK` to that URL.
4. Merge the reviewed PR. A new PR, release, or failed `CI` run will then invoke the job. CI alerts include only sanitized workflow/branch labels and a GitHub run link; fork-origin runs are ignored. Confirm any resulting message appears in the intended channel. No credential is changed by this PR.
5. For CI notifications, agent status and alerts, integrate the separate authenticated Shards event publisher service. They are not supplied by this workflow.

Security properties: default-branch checkout (not untrusted PR merge code), read-only repository permissions, no PR titles/descriptions, canonical Discord webhook URL checking, no mention parsing, explicit opt-in secret, bounded timeout and non-secret error messages. Delivery uses direct webhook HTTP; no retry or outbox and no guarantees of exactly-once delivery. Rotate the webhook immediately if exposed.
