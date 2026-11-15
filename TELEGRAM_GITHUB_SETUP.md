# GitHub → Telegram engineering notifications

**Status:** opt-in, dormant until this code is merged and two GitHub Actions secrets are set.
This feature sends *public metadata-only* GitHub PR and release events. It does not host a Telegram chat bot, deploy Hermes, run Qwen, grant GitHub write access, or connect Telegram to Discord conversations.

## Scope

- Source: only `Shards-foundation/shards-discord-bot`.
- Events: pull request opened, reopened, closed/merged; release published.
- Destination: exactly one Telegram chat identified by a secret numeric chat ID.
- Content: repository path, PR number/state, and canonical GitHub URL; no issue text, PR title, author-controlled content, code, message bodies or GitHub credentials.
- Transport: a bounded HTTPS POST from a GitHub-hosted Actions job. No persistent process and no model inference.
- Default: no-op if both secrets are absent; fail closed on partial/invalid configuration.

## Operator setup

1. Choose an existing Telegram bot under your control or make a dedicated notification-only bot using Telegram BotFather. Do not paste a bot token into Discord, GitHub issues, PRs or ChatGPT.
2. Add the bot as a member of the intended Telegram group/channel and grant only the posting permissions required. Decide whether that chat is suitable for public development notifications.
3. Determine the *numeric* Telegram destination chat ID through a trusted bot-management mechanism. A username is not interchangeable with a chat ID.
4. In this GitHub repository, set **Settings → Secrets and variables → Actions → New repository secret**:
    - `SHARDS_TELEGRAM_BOT_TOKEN`: Telegram BotFather API token.
    - `SHARDS_TELEGRAM_CHAT_ID`: signed numeric destination chat ID.
5. Have the PR reviewed, check CI, then merge the reviewed code. A subsequent selected GitHub event triggers a message. Verify the destination and rotate the bot token if compromised.

## Independent of Cue

This is a *push-only notifier*.
GitHub Actions can run when a PR or release event happens even when Cue and the Hermes process are offline.
However, live Telegram inbound commands, Discord slash commands, cross-platform conversations and local Qwen responses still require an independently deployed runtime.
Do not reuse Cue's live Telegram update consumer in a second polling process: Telegram webhooks and getUpdates are mutually exclusive.

## Security and operational limits

The job checks out only the trusted default branch, with GitHub credentials disabled, and uses read-only repository permissions.
It never executes code from incoming PR branches.
A PR from a fork does not receive Actions secrets.
Bot tokens stay in GitHub Actions secrets, never in source control.
The notifier suppresses previews, disables notification sounds and adds no Markdown/HTML parsing.
The Telegram API call has an eight-second timeout.
Delivery is best-effort with no retry/outbox, and may fail during Telegram/GitHub outages.
GitHub Actions usage is subject to the repository's available plan and limits.

For Discord engineering messages, see the existing independent draft PR #17. Do not configure overlapping webhook feeds until the intended routing has been reviewed.