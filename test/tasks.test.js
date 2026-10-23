import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createTaskStore } from '../src/tasks.js';

const requesterId = '123456789012345678';
const otherUserId = '223456789012345678';
const guildId = '323456789012345678';

async function withStore(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'shards-task-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'private', 'tasks.json');
  return { filePath, store: createTaskStore({ filePath, ...options }) };
}

test('task submission is durable and concurrent duplicate requests are idempotent', async t => {
  const { filePath, store } = await withStore(t);
  const input = { requesterId, guildId, request: '  inspect a public status page  ', idempotencyKey: 'request-0001' };
  const tasks = await Promise.all(Array.from({ length: 8 }, () => store.submit(input)));
  assert.equal(new Set(tasks.map(task => task.id)).size, 1);
  assert.equal(tasks[0].request, 'inspect a public status page');
  assert.equal(tasks[0].state, 'queued');
  const disk = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(disk.tasks.length, 1);
  assert.equal(disk.events[0].action, 'submitted');

  const restarted = createTaskStore({ filePath });
  assert.deepEqual(await restarted.get(tasks[0].id, requesterId), tasks[0]);
});

test('a worker interruption requeues the task on restart and leaves an audit event', async t => {
  const { filePath, store } = await withStore(t);
  const task = await store.submit({ requesterId, guildId, request: 'Recover me', idempotencyKey: 'request-0006' });
  await store.claimNext('worker-before-restart');
  const restarted = createTaskStore({ filePath });
  const recovered = await restarted.get(task.id, requesterId);
  assert.equal(recovered.state, 'queued');
  const events = await restarted.events(task.id, requesterId);
  assert.deepEqual(events.map(event => event.action), ['submitted', 'claimed', 'requeued_after_restart']);
  const reclaimed = await restarted.claimNext('worker-after-restart');
  assert.equal(reclaimed.attempts, 2);
});

test('repeated worker interruptions stop after three attempts', async t => {
  const { filePath } = await withStore(t);
  let store = createTaskStore({ filePath });
  const task = await store.submit({ requesterId, guildId, request: 'Bound crash recovery', idempotencyKey: 'request-0007' });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claimed = await store.claimNext(`worker-${attempt}`);
    assert.equal(claimed.attempts, attempt);
    store = createTaskStore({ filePath });
    const current = await store.get(task.id, requesterId);
    if (attempt < 3) assert.equal(current.state, 'queued');
    else {
      assert.equal(current.state, 'failed');
      assert.equal(current.failureCode, 'WORKER_INTERRUPTED');
      assert.equal(await store.claimNext('worker-final'), null);
    }
  }
});

test('task lifecycle enforces worker ownership and records terminal audit events', async t => {
  const { store } = await withStore(t);
  const task = await store.submit({ requesterId, guildId, request: 'Read-only work', idempotencyKey: 'request-0002' });
  assert.equal(await store.get(task.id, otherUserId), null);
  assert.equal(await store.get(task.id, requesterId, { guildId: '423456789012345678' }), null);
  await assert.rejects(store.cancel(task.id, otherUserId), /Not authorised/);
  await assert.rejects(store.cancel(task.id, requesterId, { guildId: '423456789012345678' }), /Not authorised/);

  const claimed = await store.claimNext('worker-a');
  assert.equal(claimed.id, task.id);
  assert.equal(claimed.state, 'running');
  assert.equal(claimed.attempts, 1);
  await assert.rejects(store.finish(task.id, 'worker-b', { result: 'done' }), /not owned/);
  const completed = await store.finish(task.id, 'worker-a', { result: 'verified output' });
  assert.equal(completed.state, 'completed');
  assert.equal(completed.result, 'verified output');
  await assert.rejects(store.finish(task.id, 'worker-a', { result: 'again' }), /not owned/);

  const events = await store.events(task.id, requesterId);
  assert.deepEqual(events.map(event => event.action), ['submitted', 'claimed', 'completed']);
  assert.equal(await store.events(task.id, otherUserId), null);
});

test('queued tasks can be cancelled by their owner but cannot be claimed afterward', async t => {
  const { store } = await withStore(t);
  const task = await store.submit({ requesterId, guildId, request: 'Cancel me', idempotencyKey: 'request-0003' });
  const cancelled = await store.cancel(task.id, requesterId);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(await store.claimNext('worker-a'), null);
  await assert.rejects(store.cancel(task.id, requesterId), /Only queued/);
});

test('task inputs and results are bounded and invalid identities are rejected', async t => {
  const { store } = await withStore(t);
  await assert.rejects(store.submit({ requesterId: 'bad', guildId, request: 'x', idempotencyKey: 'request-0004' }), /snowflake/);
  await assert.rejects(store.submit({ requesterId, guildId, request: ' ', idempotencyKey: 'request-0004' }), /request must/);
  await assert.rejects(store.submit({ requesterId, guildId, request: 'x'.repeat(2_001), idempotencyKey: 'request-0004' }), /request must/);
  const task = await store.submit({ requesterId, guildId, request: 'Bounded', idempotencyKey: 'request-0004' });
  await store.claimNext('worker-a');
  await assert.rejects(store.finish(task.id, 'worker-a', { result: 'x'.repeat(4_001) }), /4000/);
  const failed = await store.finish(task.id, 'worker-a', { failureCode: 'UPSTREAM_TIMEOUT' });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.result, null);
});

test('corrupt task data fails closed instead of silently overwriting it', async t => {
  const { filePath, store } = await withStore(t);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, '{broken json', 'utf8');
  await assert.rejects(store.submit({ requesterId, guildId, request: 'No overwrite', idempotencyKey: 'request-0005' }), /unreadable/);
  assert.equal(await readFile(filePath, 'utf8'), '{broken json');
});
