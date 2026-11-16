import test from 'node:test';
import assert from 'node:assert/strict';
import { Routes } from 'discord.js';
import {
  ACTIVITY_ENTRY_POINT, ensureActivityEntryPoint, parseEntryPointArgs,
} from '../src/activity-entry-point.js';

const APP_ID = '1562965805413568532';
const existing = [
  { id: '1000000000000000001', type: 1, name: 'sethome' },
  { id: '1000000000000000002', type: 1, name: 'status' },
  { id: '1000000000000000003', type: 1, name: 'help' },
  { id: '1000000000000000004', type: 1, name: 'custom' },
];

function fakeRest(list, created = { ...ACTIVITY_ENTRY_POINT, id: '1000000000000000010' }) {
  const calls = [];
  return {
    calls,
    async get(route) { calls.push({ method: 'GET', route }); return list; },
    async post(route, params) { calls.push({ method: 'POST', route, params }); return created; },
  };
}

test('Entry Point has the official type and Discord launch handler', () => {
  assert.deepEqual(ACTIVITY_ENTRY_POINT, {
    name: 'launch', description: 'Launch Shards Mission Control',
    type: 4, handler: 2, integration_types: [0], contexts: [0],
  });
});

test('offline by default, check read-only, apply needs two explicit flags', () => {
  assert.deepEqual(parseEntryPointArgs([]), { mode: 'preview' });
  assert.deepEqual(parseEntryPointArgs(['--check']), { mode: 'check' });
  assert.deepEqual(parseEntryPointArgs(['--apply', '--confirm-add-only']), { mode: 'apply' });
  for (const args of [['--apply'], ['--global'], ['--delete'], ['--check', '--apply']]) {
    assert.throws(() => parseEntryPointArgs(args), /Usage/);
  }
});

test('check reports missing and does not write or change original commands', async () => {
  const rest = fakeRest(existing);
  const before = JSON.stringify(existing);
  const result = await ensureActivityEntryPoint(rest, APP_ID);
  assert.deepEqual(result, { state: 'missing', changed: false, preservedCommands: 4 });
  assert.equal(JSON.stringify(existing), before);
  assert.deepEqual(rest.calls, [{ method: 'GET', route: Routes.applicationCommands(APP_ID) }]);
});

test('apply uses exactly one POST and preserves all existing slash commands', async () => {
  const rest = fakeRest(existing);
  const result = await ensureActivityEntryPoint(rest, APP_ID, { mode: 'apply' });
  assert.deepEqual(result, {
    state: 'created', changed: true, name: 'launch', preservedCommands: 4,
  });
  assert.deepEqual(rest.calls.map(x => x.method), ['GET', 'GET', 'POST']);
  assert.equal(rest.calls[2].route, Routes.applicationCommands(APP_ID));
  assert.deepEqual(rest.calls[2].params.body, ACTIVITY_ENTRY_POINT);
  assert.equal(existing.length, 4);
  assert.ok(rest.calls.every(x => !['PUT', 'PATCH', 'DELETE'].includes(x.method)));
});

test('existing Entry Point with another name is not edited or replaced', async () => {
  const rest = fakeRest([...existing, {
    id: '1000000000000000020', type: 4, name: 'open-app', handler: 2,
  }]);
  const r = await ensureActivityEntryPoint(rest, APP_ID, { mode: 'apply' });
  assert.equal(r.state, 'present');
  assert.equal(r.changed, false);
  assert.equal(r.name, 'open-app');
  assert.deepEqual(rest.calls.map(x => x.method), ['GET']);
});

test('existing app-handled Entry Point requires review and never changes', async () => {
  const rest = fakeRest([...existing, { type: 4, name: 'launch', handler: 1 }]);
  const r = await ensureActivityEntryPoint(rest, APP_ID, { mode: 'apply' });
  assert.equal(r.state, 'needs_review');
  assert.equal(r.changed, false);
  assert.equal(rest.calls.length, 1);
});

test('name conflict with existing slash command causes no write', async () => {
  const rest = fakeRest([...existing, { type: 1, name: 'launch' }]);
  const r = await ensureActivityEntryPoint(rest, APP_ID, { mode: 'apply' });
  assert.equal(r.state, 'name_conflict');
  assert.equal(rest.calls.length, 1);
});

test('unexpected/duplicate command lists fail closed', async () => {
  await assert.rejects(ensureActivityEntryPoint(fakeRest({}), APP_ID), /Invalid global/);
  await assert.rejects(ensureActivityEntryPoint(
    fakeRest([{ type: 4 }, { type: 4 }]), APP_ID), /Multiple Entry/);
});

test('remote command count or identity change aborts prior to POST', async () => {
  const rest = fakeRest(existing);
  let calls = 0;
  rest.get = async () => {
    calls += 1;
    return calls === 1 ? existing : [...existing, { id: '5', type: 1, name: 'other' }];
  };
  await assert.rejects(ensureActivityEntryPoint(rest, APP_ID, { mode: 'apply' }), /changed/);
  assert.ok(rest.calls.every(x => x.method !== 'POST'));
});

test('new command cannot claim success from unexpected Discord response', async () => {
  const rest = fakeRest(existing, { type: 1, handler: 2, name: 'launch' });
  await assert.rejects(ensureActivityEntryPoint(rest, APP_ID, { mode: 'apply' }), /unexpected result/);
});

test('unknown application ID or operation never performs a call', async () => {
  const rest = fakeRest(existing);
  await assert.rejects(ensureActivityEntryPoint(rest, '123', { mode: 'apply' }), /Invalid/);
  await assert.rejects(ensureActivityEntryPoint(rest, APP_ID, { mode: 'delete' }), /Unknown/);
  assert.equal(rest.calls.length, 0);
});
