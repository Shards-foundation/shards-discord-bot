import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readConfig } from '../src/config.js';
import { commands, handleInteraction } from '../src/commands.js';
import { registrationPlan, registerCommands } from '../src/registration.js';
import { createBot, startBot } from '../src/bot.js';
import { GatewayIntentBits, MessageFlags, Events } from 'discord.js';

function interaction(overrides = {}) {
  const replies = [];
  return {
    isChatInputCommand: () => true,
    commandName: 'ping',
    client: { ws: { ping: 42 }, guilds: { cache: { size: 3 } } },
    user: { username: 'Alice' },
    options: { getInteger: () => null, getString: () => '' },
    deferred: false,
    replied: false,
    replies,
    reply: async payload => { replies.push(payload); },
    followUp: async payload => { replies.push(payload); },
    ...overrides,
  };
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
test('registration declares the expected chat commands and bounded option schemas', () => {
  assert.deepEqual(commands.map(c => c.name), ['ping', 'hello', 'help', 'status', 'roll', 'choose', 'coinflip']);
  for (const command of commands) {
    assert.equal(command.type, 1);
    assert.ok(command.description.length > 0);
  }
  const roll = commands.find(command => command.name === 'roll');
  assert.equal(roll.options[0].min_value, 2);
  assert.equal(roll.options[0].max_value, 1000);
  const choose = commands.find(command => command.name === 'choose');
  assert.equal(choose.options[0].required, true);
  assert.equal(choose.options[0].max_length, 500);
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
test('hello greets the invoking username without triggering mentions', async () => {
  const i = interaction({ commandName: 'hello', user: { username: '@everyone' } });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /Hello, @everyone/);
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [] });
});
test('help lists the supported commands', async () => {
  const i = interaction({ commandName: 'help' });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /\/status/);
  assert.match(i.replies[0].content, /\/choose/);
});
test('status reports gateway, server count and process uptime', async () => {
  const i = interaction({ commandName: 'status' });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /Gateway latency: 42 ms/);
  assert.match(i.replies[0].content, /Connected servers: 3/);
  assert.match(i.replies[0].content, /Process uptime:/);
});
test('roll uses the requested sides and defaults to a six-sided die', async () => {
  const requested = interaction({ commandName: 'roll', options: { getInteger: () => 20 } });
  await handleInteraction(requested);
  assert.match(requested.replies[0].content, /on a d20/);
  const defaulted = interaction({ commandName: 'roll' });
  await handleInteraction(defaulted);
  assert.match(defaulted.replies[0].content, /on a d6/);
});
test('choose returns one of the supplied options and rejects too few options', async () => {
  const i = interaction({ commandName: 'choose', options: { getString: () => ' alpha, beta, gamma ' } });
  await handleInteraction(i);
  assert.match(i.replies[0].content, /I choose: \*\*(alpha|beta|gamma)\*\*/);
  const invalid = interaction({ commandName: 'choose', options: { getString: () => 'only one' } });
  await handleInteraction(invalid);
  assert.match(invalid.replies[0].content, /between 2 and 20/);
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
  const i = interaction({ reply: async payload => {
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
  for (const args of [['--guild'], ['--guild', 'abc'], ['--wat'], ['--apply', '--apply'], ['--global', '--guild', '123456789012345678'], ['--confirm-global']]) {
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
test('command CLI previews safely even with inherited Discord credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/register-commands.js'], {
    encoding: 'utf8', env: { ...process.env, DISCORD_BOT_TOKEN: 'must-not-be-used', DISCORD_APPLICATION_ID: '1562965805413568532' }, timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.apply, false);
  assert.deepEqual(output.commands.map(c => c.name), ['ping', 'hello', 'help', 'status', 'roll', 'choose', 'coinflip']);
  assert.ok(!result.stdout.includes('must-not-be-used'));
});
