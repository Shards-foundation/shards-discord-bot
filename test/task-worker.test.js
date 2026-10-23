import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskWorker } from '../src/task-worker.js';

const task = { id: 'task-1', request: 'Summarise idempotency', state: 'running' };

function fakeStore({ claimed = task } = {}) {
  const calls = [];
  return {
    calls,
    async claimNext(workerId) { calls.push(['claim', workerId]); return claimed ? structuredClone(claimed) : null; },
    async finish(id, workerId, result) { calls.push(['finish', id, workerId, result]); return { ...task, id, state: result.failureCode ? 'failed' : 'completed', ...result }; },
  };
}

test('worker claims a queued task, sends a bounded prompt to Qwen and persists its result', async () => {
  const store = fakeStore();
  let prompt;
  const worker = createTaskWorker({
    taskStore: store,
    workerId: 'test-worker',
    ollamaClient: { async chat(value) { prompt = value; return { content: 'Idempotency makes retries safe.' }; } },
    logger: { error() {} },
  });
  const outcome = await worker.processOnce();
  assert.equal(outcome.task.state, 'completed');
  assert.equal(outcome.task.result, 'Idempotency makes retries safe.');
  assert.match(prompt, /no tools, network access, shell, filesystem access/);
  assert.match(prompt, /Summarise idempotency/);
  assert.deepEqual(store.calls[0], ['claim', 'test-worker']);
  assert.deepEqual(store.calls[1], ['finish', 'task-1', 'test-worker', { result: 'Idempotency makes retries safe.' }]);
});

test('worker marks model failures as failed without exposing exception details', async () => {
  const store = fakeStore();
  const worker = createTaskWorker({
    taskStore: store,
    ollamaClient: { async chat() { throw new Error('sensitive upstream detail'); } },
    logger: { error() {} },
  });
  const outcome = await worker.processOnce();
  assert.equal(outcome.failed, true);
  assert.equal(store.calls[1][3].failureCode, 'OLLAMA_EXECUTION_FAILED');
  assert.doesNotMatch(JSON.stringify(outcome), /sensitive upstream detail/);
});

test('worker leaves an empty queue untouched', async () => {
  const store = fakeStore({ claimed: null });
  const worker = createTaskWorker({ taskStore: store, ollamaClient: { async chat() { throw new Error('must not run'); } } });
  assert.deepEqual(await worker.processOnce(), { processed: false });
  assert.equal(store.calls.length, 1);
});

test('worker rejects unsafe poll intervals and missing dependencies', () => {
  assert.throws(() => createTaskWorker({ taskStore: {}, ollamaClient: {} }), /task store/);
  assert.throws(() => createTaskWorker({ taskStore: fakeStore(), ollamaClient: {}, pollIntervalMs: 10 }), /pollIntervalMs/);
});
