import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import worker, { engineeringSnapshot, cachedEngineering, vendorUpstreamFor } from '../worker.mjs';
import { PAGE_HTML, PAGE_CSS } from '../ui.mjs';
import { CLIENT_JS } from '../client.mjs';

const repo = 'Shards-foundation';
const repos = ['shards-discord-bot','Shards-kernel','Shards-MCP'];
const canned = url => {
  if (url.includes('/pulls?')) {
    return { ok: true, json: async () => [
      { number: 31, draft: false, title: '<script>alert(1)</script>', created_at: '2026-11-15T12:00:00Z' },
      { number: 30, draft: true, title: '@everyone', created_at: '2026-11-14T12:00:00Z' },
    ] };
  }
  if (url.includes('/actions/runs?')) {
    return { ok: true, json: async () => ({ workflow_runs: [
      { id: 1000, name: 'Verify Node', status: 'completed', conclusion: 'success' },
      { id: 1001, name: 'Check security', status: 'completed', conclusion: 'failure' },
    ] }) };
  }
  throw Error('Unexpected API path');
};

test('engineering snapshots restrict all requests to exactly three public Shards repositories', async () => {
  const urls = [];
  const result = await engineeringSnapshot(async (url, options) => {
    urls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    return canned(url);
  });
  assert.equal(result.repositories.length, 3);
  assert.equal(urls.length, 6);
  assert.deepEqual(result.repositories.map(r => r.name), repos);
  assert.ok(urls.every(u => u.startsWith('https://api.github.com/repos/' + repo + '/')));
  assert.ok(urls.every(u => !u.includes('shards-github-agent')));
  assert.equal(result.actions_enabled, false);
  assert.equal(result.authenticated, false);
});

test('unsafe PR titles do not appear anywhere in the API response', async () => {
  const result = await engineeringSnapshot(canned);
  const output = JSON.stringify(result);
  assert.ok(!output.includes('<script>'));
  assert.ok(!output.includes('@everyone'));
  assert.ok(output.includes('/pull/31'));
});

test('unverified GitHub responses are marked unavailable, never healthy', async () => {
  const result = await engineeringSnapshot(async () => ({ ok: false, status: 403 }));
  assert.ok(result.repositories.every(r => r.prs === null && r.runs === null));
  assert.ok(result.repositories.every(r => r.prs_available === false && r.runs_available === false));
  assert.ok(result.repositories.every(r => r.error));
});

test('invalid run status and numeric identifiers fail closed', async () => {
  const result = await engineeringSnapshot(async url => url.includes('/pulls?')
    ? { ok:true, json:async () => [{ number:'31', draft:false }] }
    : { ok:true, json:async () => ({ workflow_runs:[
      { id:100, status:'@everyone', conclusion:'critical', name:'Unsafe' },
    ] }) });
  assert.equal(result.repositories[0].prs.length,0);
  assert.equal(result.repositories[0].runs[0].status,'unknown');
  assert.equal(result.repositories[0].runs[0].conclusion,null);
});

test('GET app shell contains landmarks, no embedded secrets and security headers', async () => {
  const res = await worker.fetch(new Request('https://activity.shardsinc.co.uk/'));
  assert.equal(res.status,200);
  assert.ok(res.headers.get('content-type').includes('text/html'));
  assert.match(res.headers.get('content-security-policy'),/frame-ancestors/);
  const html = await res.text();
  assert.match(html,/Shards Mission Control/);
  assert.match(html,/view-engineering/);
  assert.doesNotMatch(html,/DISCORD_BOT_TOKEN|CLIENT_SECRET|PRIVATE_KEY/);
});

test('static client assets are served and not substituted with HTML fallback', async () => {
  const [script,styles,missing] = await Promise.all([
    worker.fetch(new Request('https://activity.shardsinc.co.uk/app.js')),
    worker.fetch(new Request('https://activity.shardsinc.co.uk/styles.css')),
    worker.fetch(new Request('https://activity.shardsinc.co.uk/nope')),
  ]);
  assert.match(await script.text(),/detectDiscordHost/);
  assert.match(await styles.text(),/\.sidebar/);
  assert.equal(missing.status,404);
});

test('writes and unsafe methods are rejected', async () => {
  const result = await worker.fetch(new Request('https://activity.shardsinc.co.uk/api/engineering',{
    method:'POST',
  }));
  assert.equal(result.status,405);
});

test('GET health does not claim agent connections or authenticated operation', async () => {
  const res = await worker.fetch(new Request('https://activity.shardsinc.co.uk/api/health'));
  const body = await res.json();
  assert.equal(body.state,'online');
  assert.equal(body.agent_execution,'not_enabled');
  assert.equal(body.discord_auth,'not_enabled');
});

test('client code is syntactically valid and has no dynamic external tool execution', () => {
  new Script(CLIENT_JS);
  assert.ok(PAGE_HTML.includes('id="repoSearch"'));
  assert.ok(PAGE_CSS.includes('prefers-reduced-motion'));
  assert.ok(!CLIENT_JS.includes('eval('));
  assert.ok(!CLIENT_JS.includes('localStorage'));
});

test('Discord SDK requests are served from the same origin and proxy paths are constrained', () => {
  assert.equal(vendorUpstreamFor('/sdk.js'), 'https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@2.5.0/+esm');
  assert.equal(vendorUpstreamFor('/npm/zod@3.25.0/+esm'), 'https://cdn.jsdelivr.net/npm/zod@3.25.0/+esm');
  assert.equal(vendorUpstreamFor('/npm/@discord/embedded-app-sdk@2.5.0/+esm'), 'https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@2.5.0/+esm');
  assert.equal(vendorUpstreamFor('/npm/example@1.0.0/private'), null);
  assert.equal(vendorUpstreamFor('/npm/%2e%2e/secrets'), null);
  assert.equal(vendorUpstreamFor('/api/health'), null);
  assert.equal(vendorUpstreamFor('//evil.test/'), null);
  assert.ok(!CLIENT_JS.includes("import('https://cdn.jsdelivr.net"));
  assert.ok(CLIENT_JS.includes("import('/sdk.js')"));
});

test('global KV cache prevents repeated GitHub requests until refresh boundary', async () => {
  let calls = 0;
  const storage = new Map();
  const cache = {
    get: async key => JSON.parse(storage.get(key) || 'null'),
    put: async (key, value, opts) => {
      assert.equal(opts.expirationTtl, 86400);
      storage.set(key, value);
    },
  };
  const fetchImpl = async url => { calls += 1; return canned(url); };
  const env = { ENGINEERING_CACHE: cache };
  const first = await cachedEngineering(env, fetchImpl, 10000);
  assert.equal(calls, 6);
  assert.equal(first.cache_status, 'verified');
  const again = await cachedEngineering(env, fetchImpl, 20000);
  assert.equal(calls, 6);
  assert.equal(again.cache_status, 'verified');
  const nextHour = await cachedEngineering(env, fetchImpl, 3620000);
  assert.equal(calls, 12);
  assert.equal(nextHour.cache_status, 'verified');
});

test('upstream failure serves explicitly stale last verified snapshot', async () => {
  let value;
  const cache = {
    get: async () => value ? JSON.parse(value) : null,
    put: async (_key, next) => { value = next; },
  };
  const env = { ENGINEERING_CACHE: cache };
  const original = await cachedEngineering(env, canned, 0);
  assert.equal(original.cache_status, 'verified');
  const stale = await cachedEngineering(env, async () => ({ ok:false, status:403 }), 3700000);
  assert.equal(stale.cache_status, 'stale');
  assert.equal(stale.serving_stale, true);
  assert.equal(stale.fetched_at, original.fetched_at);
  assert.match(stale.warning, /unavailable/);
});
