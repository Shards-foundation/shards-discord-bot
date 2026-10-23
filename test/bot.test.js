import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../src/config.js';
import { commands, handleInteraction } from '../src/commands.js';
import { registrationPlan, registerCommands } from '../src/registration.js';
import { createBot, startBot } from '../src/bot.js';
import { createShutdownHandler } from '../src/shutdown.js';
import { GatewayIntentBits, MessageFlags, Events } from 'discord.js';

// Boundary doubles replace Discord network operations, never the command logic.
function interaction(overrides = {}) {
  const replies = [];
  return { isChatInputCommand: () => true, commandName: 'ping',
    client: { ws: { ping: 42 } }, user: { username: 'Alice' },
    options: { getInteger: () => null, getString: () => '', getSubcommand: () => 'status' },
    deferred: false, replied: false, replies,
    reply: async (payload) => { replies.push(payload); },
    followUp: async (payload) => { replies.push(payload); }, ...overrides };
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
test('registration payload exposes exactly the two supported chat commands', () => {
  assert.deepEqual(commands.map(c => ({ name: c.name, type: c.type })), [
    { name: 'ping', type: 1 }, { name: 'hello', type: 1 }, { name: 'help', type: 1 }, { name: 'roll', type: 1 }, { name: 'choose', type: 1 }, { name: 'coinflip', type: 1 }, { name: 'system', type: 1 }, { name: 'task', type: 1 },
  ]);
  for (const command of commands) assert.ok(command.description.length > 0);
  assert.equal(commands.find(c => c.name === 'roll').options[0].min_value, 2);
  assert.equal(commands.find(c => c.name === 'roll').options[0].max_value, 1000);
  assert.equal(commands.find(c => c.name === 'choose').options[0].max_length, 500);
  assert.equal(commands.find(c => c.name === 'system').options[0].name, 'status');
  assert.deepEqual(commands.find(c => c.name === 'task').options.map(option => option.name), ['submit', 'status', 'cancel']);
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
  assert.match(i.replies[0].content, /Task executor: not configured/);
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
  assert.match(i.replies[0].content, /no executor configured/);
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
  assert.deepEqual(output.commands.map(c => c.name), ['ping', 'hello', 'help', 'roll', 'choose', 'coinflip', 'system', 'task']);
  assert.ok(!result.stdout.includes('must-not-be-used'));
});
