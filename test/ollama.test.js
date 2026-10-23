import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaClient, ollamaDefaults } from '../src/ollama.js';

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('defaults to a local Ollama endpoint and Qwen 3.5 4B model', () => {
  const client = createOllamaClient({ fetchImpl: async () => response(200, { models: [] }) });
  assert.equal(client.baseUrl, ollamaDefaults.baseUrl);
  assert.equal(client.model, 'qwen3.5:4b');
});

test('rejects unsafe or malformed base URLs and invalid model names', () => {
  assert.throws(() => createOllamaClient({ baseUrl: 'file:///etc/passwd' }), /HTTP/);
  assert.throws(() => createOllamaClient({ baseUrl: 'http://user:pass@localhost:11434' }), /without credentials/);
  assert.throws(() => createOllamaClient({ model: 'qwen;rm -rf /' }), /unsupported characters/);
  assert.throws(() => createOllamaClient({ timeoutMs: 999 }), /OLLAMA_TIMEOUT_MS/);
});

test('sends a non-streaming bounded chat request to the fixed Ollama endpoint', async () => {
  let captured;
  const client = createOllamaClient({
    baseUrl: 'http://localhost:11434/',
    model: 'qwen3.5:4b',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response(200, { model: 'qwen3.5:4b', message: { content: 'Answer from Qwen.' }, total_duration: 1_500_000_000 });
    },
  });
  const answer = await client.chat('Explain idempotency.');
  assert.equal(captured.url, 'http://localhost:11434/api/chat');
  assert.equal(captured.body.model, 'qwen3.5:4b');
  assert.equal(captured.body.stream, false);
  assert.equal(captured.body.messages[1].content, 'Explain idempotency.');
  assert.equal(captured.body.options.num_predict, 512);
  assert.equal(answer.content, 'Answer from Qwen.');
  assert.equal(answer.totalDurationNs, 1_500_000_000);
});

test('rejects empty and oversized prompts before network access', async () => {
  let called = false;
  const client = createOllamaClient({ fetchImpl: async () => { called = true; return response(200, {}); } });
  await assert.rejects(client.chat('   '), /Prompt must contain/);
  await assert.rejects(client.chat('x'.repeat(3001)), /Prompt must contain/);
  assert.equal(called, false);
});

test('lists installed Ollama models and handles unavailable endpoints', async () => {
  const client = createOllamaClient({ fetchImpl: async url => {
    assert.equal(url, 'http://127.0.0.1:11434/api/tags');
    return response(200, { models: [{ name: 'qwen3.5:4b', size: 4_000_000_000 }] });
  } });
  assert.deepEqual(await client.listModels(), [{ name: 'qwen3.5:4b', size: 4_000_000_000 }]);
  const unavailable = createOllamaClient({ fetchImpl: async () => { throw new Error('connection refused'); } });
  await assert.rejects(unavailable.listModels(), /Cannot reach Ollama/);
});

test('turns missing model and HTTP errors into actionable non-sensitive messages', async () => {
  const missing = createOllamaClient({ model: 'qwen3.5:4b', fetchImpl: async () => response(404, {}) });
  await assert.rejects(missing.chat('hello'), /ollama pull/);
  const serverError = createOllamaClient({ fetchImpl: async () => response(500, {}) });
  await assert.rejects(serverError.chat('hello'), /HTTP 500/);
});
