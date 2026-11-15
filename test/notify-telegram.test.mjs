import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_REPOSITORY, validateTelegramConfig, buildTelegramMessage, publishTelegram } from '../scripts/notify-telegram.mjs';

const token = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const chatId = '-1001234567890';
const repository = { full_name: ALLOWED_REPOSITORY, fork: false };
const prEvent = { repository, action: 'closed', pull_request: { number: 27, merged: true, title: '@everyone private' } };

test('only missing both settings is an opt-in no-op', () => {
  assert.equal(validateTelegramConfig('', ''), null);
  assert.deepEqual(validateTelegramConfig(token, chatId), { botToken: token, chatId });
  assert.throws(() => validateTelegramConfig(token, ''), /configuration/);
  assert.throws(() => validateTelegramConfig('', chatId), /configuration/);
  assert.throws(() => validateTelegramConfig('not-a-token', chatId), /configuration/);
  assert.throws(() => validateTelegramConfig(token, 'abc'), /configuration/);
});

test('PR notification contains metadata only, never user-authored text', () => {
  const message = buildTelegramMessage('pull_request', prEvent);
  assert.match(message, /PR merged/);
  assert.match(message, /\/pull\/27/);
  assert.doesNotMatch(message, /private|everyone/);
});

test('repository identity must match the trusted Shards source', () => {
  assert.throws(() => buildTelegramMessage('pull_request', { ...prEvent, repository: { full_name: 'attacker/project' } }), /authorised/);
  assert.throws(() => buildTelegramMessage('pull_request', { ...prEvent, repository: { full_name: ALLOWED_REPOSITORY, fork: true } }), /authorised/);
});

test('unselected event, action or invalid PR number cannot post', () => {
  assert.equal(buildTelegramMessage('push', { repository }), null);
  assert.equal(buildTelegramMessage('pull_request', { repository, action: 'synchronize', pull_request: { number: 4 } }), null);
  assert.equal(buildTelegramMessage('pull_request', { repository, action: 'opened', pull_request: { number: '4' } }), null);
});

test('only canonical GitHub release URLs are included', () => {
  const release = { repository, action: 'published', release: {
    id: 3, html_url: 'https://github.com/Shards-foundation/shards-discord-bot/releases/tag/v1.0.0',
  } };
  assert.match(buildTelegramMessage('release', release), /Release published/);
  assert.throws(() => buildTelegramMessage('release', {
    ...release, release: { ...release.release, html_url: 'https://github.com.evil.test/Shards-foundation/shards-discord-bot/releases/tag/v1' },
  }), /Untrusted/);
  assert.throws(() => buildTelegramMessage('release', {
    ...release, release: { ...release.release, html_url: 'https://github.com/Other/repo/releases/tag/v1' },
  }), /Untrusted/);
});

test('no credentials means no Telegram API request', async () => {
  const result = await publishTelegram({ eventName: 'pull_request', event: prEvent,
    fetchImpl: () => { throw new Error('must not send'); },
  });
  assert.deepEqual(result, { status: 'skipped', reason: 'secrets_not_configured' });
});

test('delivers an inert metadata-only message to the configured chat', async () => {
  const calls = [];
  const result = await publishTelegram({
    eventName: 'pull_request', event: prEvent, botToken: token, chatId,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true }; },
  });
  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/bot' + token + '/sendMessage');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_id, chatId);
  assert.equal(body.disable_notification, true);
  assert.equal(body.link_preview_options.is_disabled, true);
  assert.equal('parse_mode' in body, false);
  assert.doesNotMatch(body.text, /everyone|private/);
});

test('Telegram rejects and network exceptions never reveal secret destinations', async () => {
  await assert.rejects(() => publishTelegram({
    eventName: 'pull_request', event: prEvent, botToken: token, chatId,
    fetchImpl: async () => ({ ok: false, status: 429 }),
  }), /HTTP 429/);
  await assert.rejects(() => publishTelegram({
    eventName: 'pull_request', event: prEvent, botToken: token, chatId,
    fetchImpl: async () => { throw new Error('private credential ' + token); },
  }), error => !error.message.includes(token) && /transport failed/.test(error.message));
});
