import test from 'node:test';
import assert from 'node:assert/strict';
import { runLiveRuntimePreflight } from '../scripts/smoke-live.js';

const env = { DISCORD_BOT_TOKEN: 'local-test-token', DISCORD_APPLICATION_ID: '123456789012345678' };
const ollamaClient = { model: 'qwen3.5:4b', async listModels() { return [{ name: 'qwen3.5:4b' }]; }, async chat() { return { content: 'SHARDS_OLLAMA_OK' }; } };

test('live preflight verifies Discord identity and then checks real model inference', async () => {
  let requested;
  const result = await runLiveRuntimePreflight({ env, ollamaClient, fetchImpl: async (url, options) => {
    requested = { url, options };
    return { ok: true, status: 200, json: async () => ({ id: env.DISCORD_APPLICATION_ID, username: 'shards-test-bot' }) };
  } });
  assert.equal(requested.url, 'https://discord.com/api/v10/users/@me');
  assert.equal(requested.options.headers.Authorization, 'Bot local-test-token');
  assert.equal(result.discord, true);
  assert.equal(result.botUsername, 'shards-test-bot');
  assert.equal(result.ollama.inference, true);
});

test('live preflight stops on invalid Discord credentials without touching Ollama', async () => {
  let ollamaCalled = false;
  await assert.rejects(runLiveRuntimePreflight({ env, ollamaClient: { async listModels() { ollamaCalled = true; return []; } }, fetchImpl: async () => ({ ok: false, status: 401 }) }), /token check failed/);
  assert.equal(ollamaCalled, false);
});

test('live preflight rejects an application ID mismatch', async () => {
  await assert.rejects(runLiveRuntimePreflight({ env, ollamaClient, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: '223456789012345678', username: 'wrong-bot' }) }) }), /does not match/);
});
