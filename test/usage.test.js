import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsageStore } from '../src/usage.js';

const actorId = '123456789012345678';
const otherActorId = '223456789012345678';
const guildId = '323456789012345678';
const otherGuildId = '423456789012345678';

async function isolatedStore(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'shards-usage-'));
  return {
    store: createUsageStore({ filePath: join(directory, 'usage.json'), ...options }),
    directory,
  };
}

const record = (overrides = {}) => ({
  actorId, guildId, source: 'ai_chat', model: 'qwen3.5:4b',
  promptTokens: 12, completionTokens: 8, durationNs: 1_500_000_000,
  ...overrides,
});

test('usage store persists aggregates and isolates by user and guild without storing prompts', async t => {
  const { store, directory } = await isolatedStore();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await store.record(record());
  await store.record(record({ guildId: otherGuildId, promptTokens: 90, completionTokens: 40 }));
  await store.record(record({ actorId: otherActorId, promptTokens: 100, completionTokens: 50 }));

  assert.deepEqual(await store.summary(actorId, guildId), {
    requests: 1,
    measuredRequests: 1,
    promptTokens: 12,
    completionTokens: 8,
    durationNs: 1_500_000_000,
    models: { 'qwen3.5:4b': 1 },
    historyTruncated: false,
  });
  const file = await readFile(join(directory, 'usage.json'), 'utf8');
  assert.doesNotMatch(file, /prompt text|generated response/);
});

test('usage store tracks calls with unavailable server metrics without inventing token counts', async t => {
  const { store, directory } = await isolatedStore();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await store.record(record({ promptTokens: null, completionTokens: null, durationNs: null }));
  const summary = await store.summary(actorId, guildId);
  assert.equal(summary.requests, 1);
  assert.equal(summary.measuredRequests, 0);
  assert.equal(summary.promptTokens, 0);
  assert.equal(summary.completionTokens, 0);
});

test('usage store retains the newest bounded records and marks truncation', async t => {
  const { store, directory } = await isolatedStore({ maxRecords: 2 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  await store.record(record({ promptTokens: 1, completionTokens: 1 }));
  await store.record(record({ promptTokens: 2, completionTokens: 2 }));
  await store.record(record({ promptTokens: 3, completionTokens: 3 }));
  const summary = await store.summary(actorId, guildId);
  assert.equal(summary.requests, 2);
  assert.equal(summary.promptTokens, 5);
  assert.equal(summary.completionTokens, 5);
  assert.equal(summary.historyTruncated, true);
});

test('usage store rejects invalid actors, sources, and token metrics', async t => {
  const { store, directory } = await isolatedStore();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(store.record(record({ actorId: 'not-a-snowflake' })), /actorId/);
  await assert.rejects(store.record(record({ source: 'github_write' })), /Unsupported usage source/);
  await assert.rejects(store.record(record({ promptTokens: -1 })), /promptTokens/);
});
