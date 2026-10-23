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


test('research uses Qwen tool calls to search public GitHub and returns the final answer', async () => {
  const requests = [];
  let modelRound = 0;
  const client = createOllamaClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url === 'https://api.github.com/search/repositories?q=qwen%20ollama&per_page=5') {
        return response(200, { items: [{ full_name: 'ollama/ollama', description: 'Run models locally', html_url: 'https://github.com/ollama/ollama', stargazers_count: 100, language: 'Go' }] });
      }
      if (url === 'http://127.0.0.1:11434/api/chat') {
        modelRound += 1;
        if (modelRound === 1) return response(200, { model: 'qwen3.5:4b', message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_public_github_repositories', arguments: { query: 'qwen ollama' } } }] } });
        const messages = JSON.parse(options.body).messages;
        assert.ok(messages.some(m => m.role === 'tool' && m.content.includes('ollama/ollama')));
        return response(200, { model: 'qwen3.5:4b', message: { role: 'assistant', content: 'Ollama hosts local model inference. Source: https://github.com/ollama/ollama' } });
      }
      throw new Error('Unexpected URL: ' + url);
    },
  });
  const result = await client.research('Research Ollama and Qwen.');
  assert.match(result.content, /Source: https:\/\/github.com\/ollama\/ollama/);
  assert.equal(result.toolCallsUsed, 1);
  assert.equal(requests.filter(r => r.url === 'https://api.github.com/search/repositories?q=qwen%20ollama&per_page=5').length, 1);
});


test('research can inspect public repository metadata and read a bounded source file', async () => {
  let round = 0;
  const calls = [];
  const client = createOllamaClient({ fetchImpl: async (url, options) => {
    calls.push(url);
    if (url === 'https://api.github.com/repos/ollama/ollama') {
      return response(200, { full_name: 'ollama/ollama', description: 'Ollama', html_url: 'https://github.com/ollama/ollama', stargazers_count: 123, forks_count: 4, open_issues_count: 2, language: 'Go', default_branch: 'main', license: { spdx_id: 'MIT' } });
    }
    if (url === 'https://api.github.com/repos/ollama/ollama/contents/README.md') {
      return response(200, { type: 'file', encoding: 'base64', path: 'README.md', html_url: 'https://github.com/ollama/ollama/blob/main/README.md', content: Buffer.from('Repository overview').toString('base64') });
    }
    if (url !== 'http://127.0.0.1:11434/api/chat') throw new Error('Unexpected URL: ' + url);
    round += 1;
    const messages = JSON.parse(options.body).messages;
    if (round === 1) return response(200, { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_public_github_repository', arguments: { owner: 'ollama', repo: 'ollama' } } }] } });
    if (round === 2) {
      assert.ok(messages.some(m => m.role === 'tool' && m.content.includes('"license":"MIT"')));
      return response(200, { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_public_github_file', arguments: { owner: 'ollama', repo: 'ollama', path: 'README.md' } } }] } });
    }
    assert.ok(messages.some(m => m.role === 'tool' && m.content.includes('Repository overview')));
    return response(200, { message: { role: 'assistant', content: 'Ollama is documented in its public README. Source: https://github.com/ollama/ollama/blob/main/README.md' } });
  } });
  const result = await client.research('Inspect the Ollama repository and read its README.');
  assert.match(result.content, /public README/);
  assert.equal(result.toolCallsUsed, 2);
  assert.ok(calls.includes('https://api.github.com/repos/ollama/ollama'));
  assert.ok(calls.includes('https://api.github.com/repos/ollama/ollama/contents/README.md'));
});

test('research tool path validation rejects traversal and secret-like files', async () => {
  let modelRound = 0;
  const client = createOllamaClient({ fetchImpl: async (url, options) => {
    if (url !== 'http://127.0.0.1:11434/api/chat') throw new Error('GitHub must not be called for blocked paths');
    modelRound += 1;
    if (modelRound === 1) return response(200, { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_public_github_file', arguments: { owner: 'owner', repo: 'repo', path: '../.env' } } }] } });
    const messages = JSON.parse(options.body).messages;
    assert.ok(messages.some(m => m.role === 'tool' && m.content.includes('disallowed repository file path')));
    return response(200, { message: { role: 'assistant', content: 'The path was rejected safely.' } });
  } });
  const result = await client.research('Try to read a repository environment file.');
  assert.match(result.content, /rejected safely/);
});

test('research stops before exceeding the bounded tool-call count', async () => {
  let called = false;
  const client = createOllamaClient({ fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    called = true;
    return response(200, { message: { role: 'assistant', content: '', tool_calls: Array.from({ length: 6 }, () => ({ function: { name: 'get_public_github_repository', arguments: { owner: 'owner', repo: 'repo' } } })) } });
  } });
  await assert.rejects(client.research('Do too many lookups'), /tool-call limit/);
  assert.equal(called, true);
});

test('turns missing model and HTTP errors into actionable non-sensitive messages', async () => {
  const missing = createOllamaClient({ model: 'qwen3.5:4b', fetchImpl: async () => response(404, {}) });
  await assert.rejects(missing.chat('hello'), /ollama pull/);
  const serverError = createOllamaClient({ fetchImpl: async () => response(500, {}) });
  await assert.rejects(serverError.chat('hello'), /HTTP 500/);
});
