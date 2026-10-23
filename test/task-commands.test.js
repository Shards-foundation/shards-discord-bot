import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags } from 'discord.js';
import { handleInteraction } from '../src/commands.js';
import { createTaskStore } from '../src/tasks.js';

const userId = '123456789012345678';
const guildId = '323456789012345678';
let nextInteraction = 423456789012345670n;

function taskInteraction(subcommand, { request = 'Review safe public information', taskId, actorId = userId } = {}) {
  const replies = [];
  const options = {
    getSubcommand: () => subcommand,
    getString: name => name === 'request' ? request : taskId,
  };
  return {
    commandName: 'task',
    id: String(nextInteraction++),
    guildId,
    user: { id: actorId },
    options,
    deferred: false,
    replied: false,
    replies,
    isChatInputCommand: () => true,
    deferReply: async payload => { replies.push(payload); },
    editReply: async payload => { replies.push(payload); },
    reply: async payload => { replies.push(payload); },
    followUp: async payload => { replies.push(payload); },
  };
}

test('task slash commands durably submit, inspect, and cancel only queued work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shards-task-command-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createTaskStore({ filePath: join(directory, 'tasks.json') });

  const submit = taskInteraction('submit');
  await handleInteraction(submit, { error() {} }, store);
  assert.equal(submit.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(submit.replies[1].content, /saved to the durable queue/);
  assert.match(submit.replies[1].content, /local Qwen worker will process it/);
  const taskId = submit.replies[1].content.match(/Task ([\w-]+) was/)[1];

  const status = taskInteraction('status', { taskId });
  await handleInteraction(status, { error() {} }, store);
  assert.match(status.replies[1].content, new RegExp(`${taskId}: queued`));

  const cancel = taskInteraction('cancel', { taskId });
  await handleInteraction(cancel, { error() {} }, store);
  assert.match(cancel.replies[1].content, /cancelled/);

  const afterCancel = taskInteraction('status', { taskId });
  await handleInteraction(afterCancel, { error() {} }, store);
  assert.match(afterCancel.replies[1].content, /cancelled/);
});

test('task status does not reveal another server member’s work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'shards-task-command-auth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createTaskStore({ filePath: join(directory, 'tasks.json') });
  const task = await store.submit({ requesterId: userId, guildId, request: 'private request', idempotencyKey: 'seed-request-001' });
  const status = taskInteraction('status', { taskId: task.id, actorId: '223456789012345678' });
  await handleInteraction(status, { error() {} }, store);
  assert.match(status.replies[1].content, /not authorised/);
  assert.ok(!status.replies[1].content.includes('private request'));
});
