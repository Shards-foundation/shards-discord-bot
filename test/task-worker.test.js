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

test('research-mode tasks use only the bounded read-only GitHub research client', async () => {
  const researchTask = { ...task, mode: 'github_research', request: 'Research Ollama public repository' };
  const store = fakeStore({ claimed: researchTask });
  let received;
  const worker = createTaskWorker({
    taskStore: store,
    ollamaClient: {
      async chat() { throw new Error('chat path must not run'); },
      async research(prompt) { received = prompt; return { content: 'Found public repository evidence.' }; },
    },
    logger: { error() {} },
  });
  const outcome = await worker.processOnce();
  assert.equal(received, researchTask.request);
  assert.equal(outcome.task.result, 'Found public repository evidence.');
});

test('worker records model usage against the task owner and guild', async () => {
  const calls = [];
  const trackedTask = { ...task, requesterId: '123456789012345678', guildId: '223456789012345678' };
  const store = fakeStore({ claimed: trackedTask });
  const worker = createTaskWorker({
    taskStore: store,
    ollamaClient: { model: 'qwen3.5:4b', async chat() {
      return { model: 'qwen3.5:4b', content: 'Done.', usage: { promptTokens: 20, completionTokens: 6, durationNs: 900_000_000 } };
    } },
    usageStore: { async record(event) { calls.push(event); } },
    logger: { error() {} },
  });
  await worker.processOnce();
  assert.deepEqual(calls, [{
    actorId: trackedTask.requesterId, guildId: trackedTask.guildId, taskId: trackedTask.id,
    source: 'task_chat', model: 'qwen3.5:4b', promptTokens: 20, completionTokens: 6, durationNs: 900_000_000,
  }]);
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
  assert.throws(() => createTaskWorker({ taskStore: fakeStore(), ollamaClient: { async chat() {} }, pollIntervalMs: 10 }), /pollIntervalMs/);
});
