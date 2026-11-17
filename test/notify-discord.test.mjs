import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, publish, validateWebhook } from '../scripts/notify-discord.mjs';

const webhook = 'https://discord.com/api/webhooks/123456789012345678/abc-token';
const repository = { full_name: 'Shards-foundation/shards-discord-bot' };
const pr = { repository, action: 'closed', pull_request: { number: 31, merged: true, title: '@everyone secret' } };

test('requires canonical Discord webhook destination', () => {
  assert.equal(validateWebhook(webhook), webhook);
  assert.throws(() => validateWebhook('https://discord.com.evil.test/api/webhooks/123456789012345678/token'));
  assert.throws(() => validateWebhook('http://discord.com/api/webhooks/123456789012345678/token'));
  assert.throws(() => validateWebhook('https://discord.com/api/webhooks/123456789012345678/token?wait=true'));
});
test('builds metadata-only PR event with no user-controlled title', () => {
  const content = buildMessage('pull_request', pr);
  assert.match(content, /PR merged/);
  assert.match(content, /\/pull\/31/);
  assert.doesNotMatch(content, /everyone|secret/);
});
test('ignores unselected events and malformed IDs', () => {
  assert.equal(buildMessage('push', { repository }), null);
  assert.equal(buildMessage('pull_request', { repository, action: 'opened', pull_request: { number: '12' } }), null);
});
test('requires validated GitHub release URL', () => {
  const good = { repository, action: 'published', release: { id: 12, html_url: 'https://github.com/Shards-foundation/shards-discord-bot/releases/tag/v1.0.0' } };
  assert.match(buildMessage('release', good), /Release published/);
  assert.throws(() => buildMessage('release', { ...good, release: { ...good.release, html_url: 'https://evil.test/' } }));
});
test('does not send when webhook secret absent', async () => {
  const result = await publish({ eventName: 'pull_request', event: pr, webhook: '', fetchImpl: () => { throw new Error('must not call'); } });
  assert.equal(result.status, 'skipped');
});
test('safe Discord payload disables mentions', async () => {
  const calls = [];
  const result = await publish({ eventName: 'pull_request', event: pr, webhook, fetchImpl: async (...args) => { calls.push(args); return { ok: true }; } });
  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0][1].body).allowed_mentions, { parse: [] });
});
test('reports remote delivery failures without leaking webhook URL', async () => {
  await assert.rejects(() => publish({ eventName: 'pull_request', event: pr, webhook, fetchImpl: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
});

const ciFailure = {
  repository,
  action: 'completed',
  workflow_run: { id: 444, name: 'CI', conclusion: 'failure', head_branch: 'feature/@everyone\nmasked', head_repository: { full_name: repository.full_name } },
};

test('formats only same-repository CI failures with sanitized labels and a run link', () => {
  const content = buildMessage('workflow_run', ciFailure);
  assert.match(content, /CI failed/);
  assert.match(content, /Workflow: CI/);
  assert.match(content, /Branch: feature\/ everyone masked/);
  assert.match(content, /\/actions\/runs\/444/);
  assert.doesNotMatch(content, /@everyone/);
  assert.equal(buildMessage('workflow_run', { ...ciFailure, workflow_run: { ...ciFailure.workflow_run, conclusion: 'success' } }), null);
  assert.equal(buildMessage('workflow_run', { ...ciFailure, workflow_run: { ...ciFailure.workflow_run, head_repository: { full_name: 'fork-owner/fork' } } }), null);
});

test('publishes one mention-safe Discord message for one CI failure event', async () => {
  const calls = [];
  const result = await publish({ eventName: 'workflow_run', event: ciFailure, webhook, fetchImpl: async (...args) => { calls.push(args); return { ok: true }; } });
  assert.equal(result.status, 'delivered');
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0][1].body);
  assert.match(payload.content, /CI failed/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});
