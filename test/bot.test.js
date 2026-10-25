import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../src/config.js';
import { commands, handleInteraction, lookupPublicRepository } from '../src/commands.js';
import { registrationPlan, registerCommands } from '../src/registration.js';
import { createBot, startBot } from '../src/bot.js';
import { createShutdownHandler } from '../src/shutdown.js';
import { createAiRequestLimiter } from '../src/ai-limiter.js';
import { GatewayIntentBits, MessageFlags, Events } from 'discord.js';

// Boundary doubles replace Discord network operations, never the command logic.
function interaction(overrides = {}) {
  const replies = [];
  const result = {
    isChatInputCommand: () => true,
    commandName: 'ping',
    client: { ws: { ping: 42 } },
    user: { id: '123456789012345678', username: 'Alice' },
    options: { getInteger: () => null, getString: () => '', getSubcommand: () => 'status' },
    deferred: false,
    replied: false,
    deferCount: 0,
    deferPayload: undefined,
    replies,
    reply: async payload => { replies.push(payload); },
    deferReply: async payload => { result.deferred = true; result.deferPayload = payload; result.deferCount += 1; },
    editReply: async payload => { result.replied = true; replies.push(payload); },
    followUp: async payload => { replies.push(payload); },
    ...overrides,
  };
  return result;
}

test('config uses the Shards app ID and trims supplied credentials', () => {
  assert.deepEqual(readConfig({ DISCORD_BOT_TOKEN: ' local-test-token ' }), {
    token: 'local-test-token', applicationId: '1562965805413568532',
  });
});
test('config rejects missing credentials without leaking supplied secrets', () => {
  assert.throws(() => readConfig({}), /DISCORD_BOT_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_BOT_TOKEN: 'secret', DISCORD_APPLICATION_ID: 'bad' }), /DISCORD_APPLICATION_ID/);
});
test('preview config needs no token but rejects invalid IDs', () => {
  assert.equal(readConfig({}, { requireToken: false }).applicationId, '1562965805413568532');
  assert.throws(() => readConfig({ DISCORD_APPLICATION_ID: '0' }, { requireToken: false }), /DISCORD_APPLICATION_ID/);
});
test('registration payload exposes the full supported command set', () => {
  assert.deepEqual(commands.map(c => ({ name: c.name, type: c.type })), [
    { name: 'ping', type: 1 }, { name: 'hello', type: 1 }, { name: 'help', type: 1 }, { name: 'roll', type: 1 }, { name: 'choose', type: 1 }, { name: 'coinflip', type: 1 }, { name: 'github', type: 1 }, { name: 'ai', type: 1 }, { name: 'system', type: 1 }, { name: 'task', type: 1 }, { name: 'usage', type: 1 }, { name: 'audit', type: 1 },
  ]);
  for (const command of commands) assert.ok(command.description.length > 0);
  assert.equal(commands.find(c => c.name === 'roll').options[0].min_value, 2);
  assert.equal(commands.find(c => c.name === 'roll').options[0].max_value, 1000);
  assert.equal(commands.find(c => c.name === 'choose').options[0].max_length, 500);
  assert.equal(commands.find(c => c.name === 'github').options[0].name, 'repo');
  assert.equal(commands.find(c => c.name === 'system').options[0].name, 'status');
  assert.deepEqual(commands.find(c => c.name === 'task').options.map(option => option.name), ['submit', 'research', 'status', 'retry', 'events', 'cancel']);
  assert.deepEqual(commands.find(c => c.name === 'usage').options.map(option => option.name), ['summary']);
  assert.deepEqual(commands.find(c => c.name === 'audit').options.map(option => option.name), ['task']);
});
test('ping replies with gateway latency and suppresses mentions', async () => {
  const i = interaction();
  await handleInteraction(i);
  assert.match(i.replies[0].content, /Pong!.*42\s?ms/);
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [] });
});
test('ping reports not-yet-known latency without a negative measurement', async () => {
  const i = interaction({ client: { ws: { ping: -1 } } });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /unavailable/i);
});
test('/system status reports truthful runtime and gateway state', async () => {
  const i = interaction({
    commandName: 'system',
    options: { getSubcommand: () => 'status' },
    client: { ws: { ping: -1 }, isReady: () => false },
  });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /Discord connection: not ready/);
  assert.match(i.replies[0].content, /Gateway latency: unavailable/);
  assert.match(i.replies[0].content, /Task executor: local Qwen worker/);
  assert.match(i.replies[0].content, /Runtime: Node\.js/);
});
test('hello greets the invoking username without triggering mentions', async () => {
  const i = interaction({ commandName: 'hello', user: { username: '@everyone' } });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /Hello, @everyone/);
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [] });
});
test('help lists community commands and truthfully labels task execution', async () => {
  const i = interaction({ commandName: 'help' });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /\/system status/);
  assert.match(i.replies[0].content, /\/choose/);
  assert.match(i.replies[0].content, /\/github repo/);
  assert.match(i.replies[0].content, /public GitHub research using bounded read-only tools/);
  assert.match(i.replies[0].content, /\/usage summary/);
  assert.match(i.replies[0].content, /policy decisions are not yet recorded/);
});
test('roll uses requested sides and defaults to a six-sided die', async () => {
  const requested = interaction({ commandName: 'roll', options: { getInteger: () => 20 } });
  await handleInteraction(requested);
  assert.match(requested.replies[0].content, /on a d20/);
  const defaulted = interaction({ commandName: 'roll' });
  await handleInteraction(defaulted);
  assert.match(defaulted.replies[0].content, /on a d6/);
});
test('choose selects only supplied options and rejects invalid option counts', async () => {
  const i = interaction({ commandName: 'choose', options: { getString: () => ' alpha, beta, gamma ' } });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /I choose: \*\*(alpha|beta|gamma)\*\*/);
  const invalid = interaction({ commandName: 'choose', options: { getString: () => 'only one' } });
  await handleInteraction(invalid);
  assert.match(invalid.replies[0].content, /between 2 and 20/);
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [] });
});
test('coinflip returns only heads or tails', async () => {
  const i = interaction({ commandName: 'coinflip' });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /Heads|Tails/);
});
test('GitHub lookup validates repository paths before making a request', async () => {
  let called = false;
  const result = await lookupPublicRepository('owner/name/extra', async () => { called = true; });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});
test('GitHub lookup reports bounded public repository metadata', async () => {
  let requestedUrl = '';
  const result = await lookupPublicRepository('octocat/Hello-World', async (url, options) => {
    requestedUrl = url;
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Accept, 'application/vnd.github+json');
    return {
      ok: true,
      status: 200,
      json: async () => ({ full_name: 'octocat/Hello-World', description: 'Example repo', stargazers_count: 1234, forks_count: 12, open_issues_count: 3, language: 'JavaScript' }),
    };
  });
  assert.equal(requestedUrl, 'https://api.github.com/repos/octocat/Hello-World');
  assert.equal(result.ok, true);
  assert.match(result.content, /octocat\/Hello-World/);
  assert.match(result.content, /1,234/);
  assert.match(result.content, /Primary language: JavaScript/);
});
test('GitHub lookup does not expose private repository existence or raw API errors', async () => {
  const missing = await lookupPublicRepository('owner/private-repo', async () => ({ ok: false, status: 404 }));
  assert.match(missing.content, /not found or not publicly accessible/);
  const limited = await lookupPublicRepository('owner/repo', async () => ({ ok: false, status: 403 }));
  assert.match(limited.content, /rate limit/);
});
test('GitHub command responds privately and suppresses mentions', async () => {
  const i = interaction({
    commandName: 'github',
    options: { getSubcommand: () => 'repo', getString: () => 'octocat/Hello-World' },
  });
  await handleInteraction(i, { error() {} }, undefined, async () => ({
    ok: true, status: 200,
    json: async () => ({ full_name: 'octocat/Hello-World', description: '@everyone demo', stargazers_count: 1, forks_count: 0, open_issues_count: 0, language: null }),
  }));
  assert.equal(i.deferred, true);
  assert.equal(i.replies[0].allowedMentions.parse.length, 0);
  assert.match(i.replies[0].content, /octocat\/Hello-World/);
});
test('AI ask invokes the configured Ollama client and returns its answer privately', async () => {
  const i = interaction({
    commandName: 'ai',
    options: { getSubcommand: () => 'ask', getString: () => 'Explain event sourcing.' },
  });
  const calls = [];
  const ollamaClient = {
    model: 'qwen3.5:4b',
    chat: async prompt => {
      calls.push(prompt);
      return { model: 'qwen3.5:4b', content: 'Event sourcing records state changes as events.', totalDurationNs: 2_000_000_000 };
    },
    listModels: async () => [],
  };
  await handleInteraction(i, { error() {} }, undefined, fetch, ollamaClient, undefined, createAiRequestLimiter());
  assert.deepEqual(calls, ['Explain event sourcing.']);
  assert.equal(i.deferred, true);
  assert.match(i.replies[0].content, /Event sourcing records state changes/);
  assert.match(i.replies[0].content, /qwen3\.5:4b/);
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [] });
});
test('AI generation is deferred once and rate-limited before model work', async () => {
  const aiLimiter = createAiRequestLimiter({ requestsPerMinute: 1, maxConcurrent: 1, now: () => 10_000 });
  let calls = 0;
  const ollamaClient = {
    model: 'qwen3.5:4b',
    chat: async () => { calls += 1; return { model: 'qwen3.5:4b', content: 'One answer.' }; },
    listModels: async () => [],
  };
  const makeAI = () => interaction({
    commandName: 'ai', guildId: '323456789012345678', user: { id: '123456789012345678', username: 'Alice' },
    options: { getSubcommand: () => 'ask', getString: () => 'Explain queue backpressure.' },
  });
  const first = makeAI();
  await handleInteraction(first, { error() {} }, undefined, fetch, ollamaClient, undefined, aiLimiter);
  assert.equal(first.deferCount, 1);
  assert.equal(first.deferPayload.flags, MessageFlags.Ephemeral);
  assert.equal(calls, 1);

  const second = makeAI();
  await handleInteraction(second, { error() {} }, undefined, fetch, ollamaClient, undefined, aiLimiter);
  assert.equal(second.deferCount, 1);
  assert.equal(second.deferPayload.flags, MessageFlags.Ephemeral);
  assert.match(second.replies.at(-1).content, /AI request limit reached/);
  assert.equal(calls, 1);
  assert.equal(aiLimiter.active, 0);

  const dmLimiter = createAiRequestLimiter({ requestsPerMinute: 1, maxConcurrent: 1, now: () => 10_000 });
  const makeDM = () => interaction({
    commandName: 'ai', guildId: null, user: { id: '123456789012345678', username: 'Alice' },
    options: { getSubcommand: () => 'ask', getString: () => 'Explain queue backpressure.' },
  });
  const dmFirst = makeDM();
  await handleInteraction(dmFirst, { error() {} }, undefined, fetch, ollamaClient, undefined, dmLimiter);
  const dmSecond = makeDM();
  await handleInteraction(dmSecond, { error() {} }, undefined, fetch, ollamaClient, undefined, dmLimiter);
  assert.match(dmSecond.replies.at(-1).content, /per minute in this DM/);
  assert.equal(calls, 2);
});
test('AI research invokes the read-only research capability and labels tool usage', async () => {
  const i = interaction({ commandName: 'ai', options: { getSubcommand: () => 'research', getString: () => 'Find Qwen repositories.' } });
  const client = {
    model: 'qwen3.5:4b',
    chat: async () => { throw new Error('chat must not be called for research'); },
    research: async prompt => ({ model: 'qwen3.5:4b', content: 'Found public repositories with source URLs.', toolCallsUsed: 2 }),
    listModels: async () => [],
  };
  await handleInteraction(i, { error() {} }, undefined, fetch, client, undefined, createAiRequestLimiter());
  assert.match(i.replies[0].content, /Found public repositories/);
  assert.match(i.replies[0].content, /research tools: 2/);
});
test('AI status and models query the configured Ollama endpoint', async () => {
  const client = {
    model: 'qwen3.5:4b',
    chat: async () => { throw new Error('not expected'); },
    listModels: async () => [{ name: 'qwen3.5:4b', size: 4_000_000_000 }, { name: 'nomic-embed-text:latest', size: 300_000_000 }],
  };
  const status = interaction({ commandName: 'ai', options: { getSubcommand: () => 'status' } });
  await handleInteraction(status, { error() {} }, undefined, fetch, client);
  assert.match(status.replies[0].content, /Ollama API: reachable/);
  assert.match(status.replies[0].content, /Model installed: yes/);
  const models = interaction({ commandName: 'ai', options: { getSubcommand: () => 'models' } });
  await handleInteraction(models, { error() {} }, undefined, fetch, client);
  assert.match(models.replies[0].content, /qwen3\.5:4b/);
  assert.match(models.replies[0].content, /nomic-embed-text/);
});
test('AI endpoint failures are handled without leaking provider internals', async () => {
  const i = interaction({ commandName: 'ai', options: { getSubcommand: () => 'ask', getString: () => 'hello' } });
  const aiLimiter = createAiRequestLimiter();
  await handleInteraction(i, { error() {} }, undefined, fetch, {
    model: 'qwen3.5:4b',
    chat: async () => { throw new Error('internal host secret'); },
    listModels: async () => [],
  }, undefined, aiLimiter);
  assert.match(i.replies.at(-1).content, /Something went wrong/);
  assert.ok(!JSON.stringify(i.replies).includes('internal host secret'));
  assert.equal(aiLimiter.active, 0);
});
test('non-chat interactions and unknown commands are ignored', async () => {
  for (const i of [interaction({ isChatInputCommand: () => false }), interaction({ commandName: 'missing' })]) {
    await handleInteraction(i);
    assert.deepEqual(i.replies, []);
  }
});
test('command failure sends a private fallback and logs no credential-bearing error', async () => {
  const errors = [];
  let attempts = 0;
  const i = interaction({ reply: async (payload) => {
    if (++attempts === 1) throw new Error('sensitive-token');
    i.replies.push(payload);
  } });
  await handleInteraction(i, { error: (...args) => errors.push(args) });
  assert.equal(i.replies[0].flags, MessageFlags.Ephemeral);
  assert.ok(!JSON.stringify(errors).includes('sensitive-token'));
});
test('already acknowledged interaction uses followUp for failure', async () => {
  const i = interaction({ replied: true, reply: async () => { throw new Error('failure'); } });
  await handleInteraction(i, { error() {} });
  assert.equal(i.replies.length, 1);
  assert.equal(i.replies[0].flags, MessageFlags.Ephemeral);
});
test('a failed error reply is contained', async () => {
  const i = interaction({ reply: async () => { throw new Error('network'); } });
  await assert.doesNotReject(handleInteraction(i, { error() {} }));
});
test('registration defaults to an offline global preview', () => {
  assert.deepEqual(registrationPlan([]), { apply: false, scope: 'global', guildId: null });
});
test('registration requires a scope and a second explicit global safeguard', () => {
  assert.throws(() => registrationPlan(['--apply']), /scope/i);
  assert.throws(() => registrationPlan(['--apply', '--global']), /confirm-global/);
  assert.deepEqual(registrationPlan(['--apply', '--global', '--confirm-global']), { apply: true, scope: 'global', guildId: null });
  assert.deepEqual(registrationPlan(['--apply', '--guild', '123456789012345678']), { apply: true, scope: 'guild', guildId: '123456789012345678' });
});
test('registration rejects invalid, unknown, repeated or conflicting arguments', () => {
  for (const args of [['--guild'], ['--guild', 'abc'], ['--wat'], ['--global', '--guild', '123456789012345678'], ['--apply', '--apply'], ['--confirm-global']]) {
    assert.throws(() => registrationPlan(args));
  }
});
test('preview never calls REST and writes preserve the selected scope', async () => {
  const calls = [];
  const rest = { put: async (route, options) => { calls.push({ route, options }); return []; } };
  await registerCommands(rest, '1562965805413568532', registrationPlan([]));
  assert.deepEqual(calls, []);
  await registerCommands(rest, '1562965805413568532', registrationPlan(['--apply', '--guild', '123456789012345678']));
  assert.equal(calls[0].route, '/applications/1562965805413568532/guilds/123456789012345678/commands');
  assert.deepEqual(calls[0].options.body, commands);
  await registerCommands(rest, '1562965805413568532', registrationPlan(['--apply', '--global', '--confirm-global']));
  assert.equal(calls[1].route, '/applications/1562965805413568532/commands');
});
test('client uses only the Guilds intent and never permits mentions', () => {
  const client = createBot({ info() {}, error() {} });
  assert.deepEqual(client.options.intents.toArray(), ['Guilds']);
  assert.equal(client.options.intents.has(GatewayIntentBits.MessageContent), false);
  assert.deepEqual(client.options.allowedMentions.parse, []);
  assert.equal(client.listenerCount(Events.InteractionCreate), 1);
  client.destroy();
});
test('startup logs in with supplied token and never registers commands', async () => {
  let loginToken;
  const client = { login: async token => { loginToken = token; } };
  assert.equal(await startBot({ token: 'offline-test' }, client), client);
  assert.equal(loginToken, 'offline-test');
});
test('shutdown is idempotent, awaits Discord teardown, and never leaks raw errors', async () => {
  let destroyCount = 0;
  const exitCodes = [];
  const errors = [];
  const handler = createShutdownHandler({ destroy: async () => { destroyCount += 1; } }, {
    logger: { info() {}, error: (...args) => errors.push(args) },
    onComplete: code => exitCodes.push(code),
  });
  await Promise.all([handler('SIGTERM'), handler('SIGINT')]);
  assert.equal(destroyCount, 1);
  assert.deepEqual(exitCodes, [0]);
  assert.deepEqual(errors, []);
});
test('shutdown contains Discord teardown failures and reports a nonzero result', async () => {
  const exitCodes = [];
  const handler = createShutdownHandler({ destroy: async () => { throw new Error('secret-bearing raw failure'); } }, {
    logger: { info() {}, error() {} }, onComplete: code => exitCodes.push(code),
  });
  await handler('SIGTERM');
  assert.deepEqual(exitCodes, [1]);
});
test('command CLI previews safely even with inherited Discord credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/register-commands.js'], {
    encoding: 'utf8', env: { ...process.env, DISCORD_BOT_TOKEN: 'must-not-be-used', DISCORD_APPLICATION_ID: '1562965805413568532' }, timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.apply, false);
  assert.deepEqual(output.commands.map(c => c.name), ['ping', 'hello', 'help', 'roll', 'choose', 'coinflip', 'github', 'ai', 'system', 'task', 'usage', 'audit']);
  assert.ok(!result.stdout.includes('must-not-be-used'));
});
