import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecentMessages, makeThreadPrompt, postBoundedReply, handleMentionMessage } from '../src/thread-context.js';

test('thread history is ordered oldest-first, bounded, and filters bots/empty messages', async () => {
  const channel = { messages: { fetch: async () => new Map([
    ['new', { author: { username: 'new', bot: false }, content: 'last', createdTimestamp: 2 }],
    ['bot', { author: { username: 'bot', bot: true }, content: 'ignore', createdTimestamp: 3 }],
    ['old', { author: { username: 'old', bot: false }, content: 'first', createdTimestamp: 1 }],
    ['empty', { author: { username: 'empty', bot: false }, content: ' ', createdTimestamp: 4 }],
  ]) } };
  assert.deepEqual(await readRecentMessages(channel), ['old: first', 'new: last']);
});

test('thread prompt treats conversation as untrusted and caps prompt length', () => {
  const prompt = makeThreadPrompt(['alice: hello'], 'summarise', 'summarize');
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /alice: hello/);
  assert.ok(prompt.length <= 3000);
});

test('thread reply suppresses mentions and caps content', async () => {
  let sent;
  await postBoundedReply({ send: async value => { sent = value; return value; } }, '@everyone ' + 'x'.repeat(2000));
  assert.deepEqual(sent.allowedMentions, { parse: [] });
  assert.ok(sent.content.length <= 1800);
});

test('mention handler ignores non-mentions and bot authors', async () => {
  let calls = 0;
  const client = { user: { id: '123' } };
  const ollama = { chat: async () => { calls++; return { content: 'reply' }; } };
  await handleMentionMessage({ guildId: 'g', author: { bot: true }, mentions: { has: () => true } }, client, ollama);
  await handleMentionMessage({ guildId: 'g', author: { bot: false }, mentions: { has: () => false } }, client, ollama);
  assert.equal(calls, 0);
});
