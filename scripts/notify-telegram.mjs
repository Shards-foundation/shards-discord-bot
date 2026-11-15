import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const ALLOWED_REPOSITORY = 'Shards-foundation/shards-discord-bot';
const TOKEN_PATTERN = /^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID_PATTERN = /^-?[0-9]{4,20}$/;

export function validateTelegramConfig(botToken, chatId) {
  if (!botToken && !chatId) return null;
  if (typeof botToken !== 'string' || !TOKEN_PATTERN.test(botToken)
    || typeof chatId !== 'string' || !CHAT_ID_PATTERN.test(chatId)) {
    throw new Error('Telegram notifier configuration is incomplete or invalid.');
  }
  return { botToken, chatId };
}

export function buildTelegramMessage(eventName, event) {
  if (event?.repository?.full_name !== ALLOWED_REPOSITORY || event.repository.fork === true) {
    throw new Error('GitHub event repository is not authorised.');
  }
  const root = 'https://github.com/' + ALLOWED_REPOSITORY;
  if (eventName === 'pull_request') {
    const action = event.action;
    const number = event?.pull_request?.number;
    if (!['opened', 'reopened', 'closed'].includes(action)
      || !Number.isSafeInteger(number) || number < 1) return null;
    const state = action === 'closed'
      ? (event.pull_request.merged === true ? 'merged' : 'closed') : action;
    return 'Shards engineering | PR ' + state + '\n'
      + ALLOWED_REPOSITORY + ' #' + number + '\n'
      + root + '/pull/' + number;
  }
  if (eventName === 'release') {
    if (event.action !== 'published' || !Number.isSafeInteger(event.release?.id)
      || event.release.id < 1 || typeof event.release.html_url !== 'string') return null;
    let releaseUrl;
    try { releaseUrl = new URL(event.release.html_url); } catch {
      throw new Error('Untrusted GitHub release URL.');
    }
    if (releaseUrl.protocol !== 'https:' || releaseUrl.hostname !== 'github.com'
      || releaseUrl.port || releaseUrl.username || releaseUrl.password
      || releaseUrl.search || releaseUrl.hash
      || !releaseUrl.pathname.startsWith('/' + ALLOWED_REPOSITORY + '/releases/')) {
      throw new Error('Untrusted GitHub release URL.');
    }
    return 'Shards engineering | Release published\n'
      + ALLOWED_REPOSITORY + '\n' + releaseUrl.href;
  }
  return null;
}

export async function publishTelegram({
  eventName, event, botToken, chatId, fetchImpl = fetch,
} = {}) {
  const config = validateTelegramConfig(botToken, chatId);
  if (!config) return { status: 'skipped', reason: 'secrets_not_configured' };
  const text = buildTelegramMessage(eventName, event);
  if (!text) return { status: 'skipped', reason: 'event_not_selected' };
  let response;
  try {
    response = await fetchImpl('https://api.telegram.org/bot' + config.botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        link_preview_options: { is_disabled: true },
        disable_notification: true,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error('Telegram notification transport failed.');
  }
  if (!response.ok) {
    throw new Error('Telegram notification rejected (HTTP ' + Number(response.status) + ').');
  }
  return { status: 'delivered' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventName || !eventPath) throw new Error('GitHub event environment is required.');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const result = await publishTelegram({
    eventName,
    event,
    botToken: process.env.SHARDS_TELEGRAM_BOT_TOKEN,
    chatId: process.env.SHARDS_TELEGRAM_CHAT_ID,
  });
  console.log('Telegram notification: ' + result.status);
}
