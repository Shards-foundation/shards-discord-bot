import { readFile } from 'node:fs/promises';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WEBHOOK_PATH_RE = /^\/api\/webhooks\/[0-9]{16,20}\/[A-Za-z0-9._-]+$/;

export function validateWebhook(raw) {
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid Discord webhook URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password || url.search || url.hash || !WEBHOOK_PATH_RE.test(url.pathname)) {
    throw new Error('Webhook must be a canonical https://discord.com/api/webhooks/... URL.');
  }
  return url.href;
}

export function buildMessage(eventName, event) {
  const repo = event?.repository?.full_name;
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new Error('Invalid GitHub repository.');
  const root = `https://github.com/${repo}`;
  if (eventName === 'pull_request') {
    const action = event.action;
    const number = event?.pull_request?.number;
    if (!['opened', 'reopened', 'closed'].includes(action) || !Number.isSafeInteger(number) || number < 1) return null;
    const state = action === 'closed' ? (event.pull_request.merged === true ? 'merged' : 'closed') : action;
    return `**Shards engineering · PR ${state}**\n${repo} #${number}\n${root}/pull/${number}`;
  }
  if (eventName === 'release') {
    if (event.action !== 'published' || !Number.isSafeInteger(event.release?.id) || event.release.id < 1) return null;
    const candidate = event.release.html_url;
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${repo}/releases/`) || url.username || url.password) throw new Error('Untrusted release URL.');
    return `**Shards engineering · Release published**\n${repo}\n${url.href}`;
  }
  return null;
}

export async function publish({ eventName, event, webhook, fetchImpl = fetch }) {
  const url = validateWebhook(webhook);
  if (!url) return { status: 'skipped', reason: 'webhook_not_configured' };
  const content = buildMessage(eventName, event);
  if (!content) return { status: 'skipped', reason: 'event_not_selected' };
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Discord delivery HTTP ${response.status}`);
  return { status: 'delivered' };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !eventName) throw new Error('GitHub event environment required.');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const result = await publish({ eventName, event, webhook: process.env.SHARDS_DISCORD_WEBHOOK });
  console.log(`Discord notification: ${result.status}`);
}
