import test from 'node:test';
import assert from 'node:assert/strict';
import { runOllamaSmokeTest } from '../scripts/smoke-ollama.js';

test('live Ollama smoke check requires the configured model and successful inference', async () => {
  const result = await runOllamaSmokeTest({
    model: 'qwen3.5:4b',
    async listModels() { return [{ name: 'qwen3.5:4b' }]; },
    async chat(prompt) { assert.match(prompt, /SHARDS_OLLAMA_OK/); return { content: 'SHARDS_OLLAMA_OK' }; },
  });
  assert.deepEqual(result, { model: 'qwen3.5:4b', installed: true, inference: true, responseCharacters: 15 });
});

test('live Ollama smoke check fails clearly when the configured model is absent', async () => {
  await assert.rejects(runOllamaSmokeTest({ model: 'qwen3.5:4b', async listModels() { return []; }, async chat() { throw new Error('must not run'); } }), /model is not installed/);
});
