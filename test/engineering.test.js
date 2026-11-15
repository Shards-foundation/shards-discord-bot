import test from 'node:test';
import assert from 'node:assert/strict';
import { getShardsEngineeringSnapshot, PUBLIC_SHARDS_PROJECTS } from '../src/engineering.js';

const base = 'https://api.github.com/repos/Shards-foundation/Shards-kernel';
const good = (body) => ({ ok: true, json: async () => body });

test('public projects are allowlisted and exclude private Shards GitHub Agent', () => {
  assert.deepEqual(PUBLIC_SHARDS_PROJECTS, ['shards-discord-bot', 'Shards-kernel', 'Shards-MCP']);
});

test('engineering snapshot formats grounded pull requests and main CI metadata', async () => {
  const urls = [];
  const fetchImpl = async (url, options) => {
    urls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['User-Agent'], 'Shards-Discord-Bot');
    if (url.endsWith('/pulls?state=open&per_page=5')) return good([
      { number: 23, draft: true, title: '@everyone credentials' },
      { number: 22, draft: false, title: 'private prompt text' },
    ]);
    if (url.endsWith('/actions/runs?branch=main&per_page=1')) return good({
      workflow_runs: [{ id: 123456, status: 'completed', conclusion: 'success', name: '@everyone' }],
    });
    throw new Error('Unexpected URL');
  };
  const result = await getShardsEngineeringSnapshot('Shards-kernel', fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(urls.length, 2);
  assert.ok(urls.every(u => u.startsWith(base)));
  assert.match(result.content, /#23 \(draft\)/);
  assert.match(result.content, /\/pull\/22/);
  assert.match(result.content, /completed \/ success/);
  assert.match(result.content, /\/actions\/runs\/123456/);
  assert.doesNotMatch(result.content, /everyone|credentials|private prompt/);
});

test('private or user-supplied repository paths cannot escape the allowlist', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('not called'); };
  for (const project of ['shards-github-agent', '../secret', 'OtherOrg/repo', 'https://evil.test/']) {
    const result = await getShardsEngineeringSnapshot(project, fetchImpl);
    assert.equal(result.ok, false);
  }
  assert.equal(called, false);
});

test('API failures are labelled unavailable, never represented as healthy', async () => {
  const result = await getShardsEngineeringSnapshot('shards-discord-bot', async () => ({ ok: false, status: 403 }));
  assert.equal(result.ok, true);
  assert.match(result.content, /PR data: unavailable/);
  assert.match(result.content, /Workflow data: unavailable/);
  assert.doesNotMatch(result.content, /success/);
});

test('network errors do not surface raw credential-bearing text', async () => {
  const result = await getShardsEngineeringSnapshot('Shards-MCP', async () => { throw new Error('secret token'); });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.content, /secret token/);
  assert.match(result.content, /unavailable/);
});

test('malformed workflow states and PR IDs are not echoed into Discord', async () => {
  const result = await getShardsEngineeringSnapshot('Shards-MCP', async url => {
    if (url.includes('/pulls?')) return good([{ number: '1', title: '@everyone' }]);
    return good({ workflow_runs: [{ id: 1000, status: '@everyone', conclusion: 'compromised' }] });
  });
  assert.match(result.content, /unknown/);
  assert.doesNotMatch(result.content, /@everyone|compromised/);
  assert.doesNotMatch(result.content, /\/pull\/1/);
});

test('a full PR page notes that additional open requests may exist', async () => {
  const result = await getShardsEngineeringSnapshot('Shards-kernel', async url => {
    if (url.includes('/pulls?')) return good([1, 2, 3, 4, 5].map(number => ({ number, draft: false })));
    return good({ workflow_runs: [] });
  });
  assert.match(result.content, /Other open PRs may exist/);
});
