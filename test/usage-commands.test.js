import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleInteraction } from '../src/commands.js';
import { createTaskStore } from '../src/tasks.js';
import { createUsageStore } from '../src/usage.js';
import { createAiRequestLimiter } from '../src/ai-limiter.js';
import { MessageFlags } from 'discord.js';

const actorId = '123456789012345678';
const otherActorId = '223456789012345678';
const guildId = '323456789012345678';

function makeInteraction(commandName, subcommand, values = {}, overrides = {}) {
  const replies = [];
  const interaction = {
    isChatInputCommand: () => true,
    commandName,
    guildId,
    user: { id: actorId, username: 'TestUser' },
    options: {
      getSubcommand: () => subcommand,
      getString: name => values[name] ?? '',
      getInteger: () => null,
    },
    client: { ws: { ping: 10 }, isReady: () => true },
    deferred: false,
    replied: false,
    replies,
    reply: async payload => { replies.push(payload); interaction.replied = true; },
    deferReply: async payload => { interaction.deferred = true; interaction.deferPayload = payload; },
    editReply: async payload => { replies.push(payload); interaction.replied = true; },
    followUp: async payload => { replies.push(payload); },
    ...overrides,
  };
  return interaction;
}

async function tempDir(t) {
  const directory = await mkdtemp(join(tmpdir(), 'shards-governance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('/ai ask records server-reported usage and /usage summary displays private totals and real limits', async t => {
  const directory = await tempDir(t);
  const taskStore = createTaskStore({ filePath: join(directory, 'tasks.json') });
  const usageStore = createUsageStore({ filePath: join(directory, 'usage.json') });
  const aiLimiter = createAiRequestLimiter({ requestsPerMinute: 4, maxConcurrent: 2 });
  const client = {
    model: 'qwen3.5:4b',
    async chat() {
      return {
        model: 'qwen3.5:4b', content: 'A private answer.', totalDurationNs: 2_000_000_000,
        usage: { promptTokens: 17, completionTokens: 9, durationNs: 2_000_000_000 },
      };
    },
  };
  const ai = makeInteraction('ai', 'ask', { prompt: 'Explain an event log.' });
  await handleInteraction(ai, { error() {} }, taskStore, fetch, client, usageStore, aiLimiter);
  assert.match(ai.replies[0].content, /A private answer/);

  const usage = makeInteraction('usage', 'summary');
  await handleInteraction(usage, { error() {} }, taskStore, fetch, client, usageStore, aiLimiter);
  assert.equal(usage.deferPayload.flags, MessageFlags.Ephemeral);
  assert.match(usage.replies[0].content, /Prompt tokens: 17/);
  assert.match(usage.replies[0].content, /Generated tokens: 9/);
  assert.match(usage.replies[0].content, /4 requests\/minute per requester/i);
  assert.match(usage.replies[0].content, /2 concurrent direct calls per process/i);
  assert.match(usage.replies[0].content, /Active task limit: 5 queued\/running tasks per requester\/server/);
  assert.match(usage.replies[0].content, /research up to 6 rounds/);

  const dmAI = makeInteraction('ai', 'ask', { prompt: 'A direct-message prompt.' }, { guildId: null });
  await handleInteraction(dmAI, { error() {} }, taskStore, fetch, client, usageStore, aiLimiter);
  const dmUsage = makeInteraction('usage', 'summary', {}, { guildId: null });
  await handleInteraction(dmUsage, { error() {} }, taskStore, fetch, client, usageStore, aiLimiter);
  assert.match(dmUsage.replies[0].content, /Prompt tokens: 17/);
});

test('/audit task shows only the requester’s task lifecycle events, not request or result text', async t => {
  const directory = await tempDir(t);
  const taskStore = createTaskStore({ filePath: join(directory, 'tasks.json') });
  const task = await taskStore.submit({
    requesterId: actorId, guildId, request: 'sensitive private request text', idempotencyKey: 'request-audit-0001',
  });
  await taskStore.claimNext('audit-test-worker');
  await taskStore.finish(task.id, 'audit-test-worker', { result: 'sensitive private result text' });

  const audit = makeInteraction('audit', 'task', { task_id: task.id });
  await handleInteraction(audit, { error() {} }, taskStore);
  assert.equal(audit.deferPayload.flags, MessageFlags.Ephemeral);
  assert.match(audit.replies[0].content, /submitted/);
  assert.match(audit.replies[0].content, /completed/);
  assert.match(audit.replies[0].content, /Policy decisions are not yet recorded/);
  assert.doesNotMatch(audit.replies[0].content, /sensitive private request text|sensitive private result text/);

  const unauthorized = makeInteraction('audit', 'task', { task_id: task.id }, { user: { id: otherActorId, username: 'Other' } });
  await handleInteraction(unauthorized, { error() {} }, taskStore);
  assert.match(unauthorized.replies[0].content, /not authorised/);
});
