import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, handleInteraction } from '../src/commands.js';
import { MessageFlags } from 'discord.js';

test('/shards engineering is registered with only allowlisted public projects', () => {
  const c = commands.find(x => x.name === 'shards');
  assert.ok(c);
  const projects = c.options[0].options[0].choices.map(item => item.value);
  assert.deepEqual(projects, ['shards-discord-bot', 'Shards-kernel', 'Shards-MCP']);
});

test('/shards engineering returns private, safe GitHub-derived information without Ollama', async () => {
  const replies = [];
  let requests = 0;
  const interaction = {
    commandName: 'shards',
    guildId: '721910214999408642',
    user: { id: '123456789012345678' },
    isChatInputCommand: () => true,
    options: { getSubcommand: () => 'engineering', getString: () => 'Shards-kernel' },
    deferReply: async payload => { replies.push(payload); },
    editReply: async payload => { replies.push(payload); },
  };
  const fetchImpl = async url => {
    requests += 1;
    if (url.includes('/pulls?')) return { ok: true, json: async () => [{ number: 45, draft: true, title: '@everyone' }] };
    if (url.includes('/actions/runs?')) return { ok: true, json: async () => ({
      workflow_runs: [{ id: 150, status: 'completed', conclusion: 'success' }],
    }) };
    throw new Error('Unexpected URL');
  };
  await handleInteraction(interaction, { error() {} }, undefined, fetchImpl, {
    chat: async () => { throw new Error('Ollama must not be called'); },
    research: async () => { throw new Error('Ollama must not be called'); },
  });
  assert.equal(requests, 2);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[1].content, /Shards-kernel/);
  assert.match(replies[1].content, /\/pull\/45/);
  assert.deepEqual(replies[1].allowedMentions, { parse: [] });
  assert.doesNotMatch(replies[1].content, /everyone/);
});

test('/shards status and agents are registered as read-only subcommands', () => {
  const shards = commands.find(command => command.name === 'shards');
  assert.deepEqual(shards.options.map(option => option.name), ['engineering', 'status', 'agents']);
});

test('/shards status is read-only, private, and reports runtime health', async () => {
  const replies = [];
  let fetchCalls = 0;
  const client = { isReady: () => true, ws: { ping: 37 }, taskWorker: { running: true } };
  const interaction = { commandName: 'shards', client, isChatInputCommand: () => true, options: { getSubcommand: () => 'status' }, reply: async payload => { replies.push(payload); } };
  const fetchImpl = async () => { fetchCalls += 1; throw new Error('status must not fetch'); };
  const ollamaClient = { chat: async () => { throw new Error('status must not run a model'); }, research: async () => { throw new Error('status must not run a model'); } };
  await handleInteraction(interaction, { error() {} }, undefined, fetchImpl, ollamaClient);
  assert.equal(fetchCalls, 0);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  assert.match(replies[0].content, /Bot readiness: ready/);
  assert.match(replies[0].content, /Gateway latency: 37 ms/);
  assert.match(replies[0].content, /Local task worker: running/);
});

test('/shards agents reports only configured worker state without task data', async () => {
  const replies = [];
  let fetchCalls = 0;
  const interaction = { commandName: 'shards', client: { taskWorker: { running: false } }, isChatInputCommand: () => true, options: { getSubcommand: () => 'agents' }, reply: async payload => { replies.push(payload); } };
  const fetchImpl = async () => { fetchCalls += 1; throw new Error('agents must not fetch'); };
  const ollamaClient = { chat: async () => { throw new Error('agents must not run a model'); }, research: async () => { throw new Error('agents must not run a model'); } };
  await handleInteraction(interaction, { error() {} }, undefined, fetchImpl, ollamaClient);
  assert.equal(fetchCalls, 0);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  assert.match(replies[0].content, /Local Qwen task worker: stopped/);
  assert.match(replies[0].content, /Remote agent integrations: none configured/);
  assert.doesNotMatch(replies[0].content, /Task [A-Za-z0-9_-]+|requester|prompt/i);
});
