import { PAGE_HTML, PAGE_CSS } from './ui.mjs';
import { CLIENT_JS } from './client.mjs';

const REPOSITORIES = Object.freeze(['shards-discord-bot', 'Shards-kernel', 'Shards-MCP']);
const OWNER = 'Shards-foundation';
const APP_NAME = 'Shards Mission Control';
const CACHE_SECONDS = 3600;
const CACHE_KEY = 'engineering-snapshot-v1';
const CACHE_EXPIRATION_SECONDS = 86400;
const SDK_ASSET_KEY = 'discord-sdk-v250';
const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-resource-policy': 'cross-origin',
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: https://cdn.discordapp.com",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'self' https://discord.com https://*.discord.com https://discordapp.com https://*.discordapp.com",
  ].join('; '),
});

function response(body, type, status = 200, cache = 'no-store') {
  return new Response(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': type,
      'cache-control': cache,
    },
  });
}

function json(body, status = 200) {
  return response(JSON.stringify(body), 'application/json; charset=utf-8', status, 'public, max-age=30, s-maxage=30');
}

function safeString(value, max = 100) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

async function sdkAsset(request, env = {}) {
  const store = env?.ENGINEERING_CACHE;
  if (!store || typeof store.get !== 'function') {
    return response('Discord SDK asset not configured', 'text/plain; charset=utf-8', 503);
  }
  try {
    const bundle = await store.get(SDK_ASSET_KEY, 'text');
    if (typeof bundle !== 'string' || bundle.length < 100000 || bundle.length > 2000000) {
      return response('Discord SDK asset unavailable', 'text/plain; charset=utf-8', 503);
    }
    return response(request.method === 'HEAD' ? null : bundle,
      'text/javascript; charset=utf-8', 200, 'public, max-age=86400, immutable');
  } catch {
    return response('Discord SDK asset unavailable', 'text/plain; charset=utf-8', 503);
  }
}

async function githubGet(path, fetchImpl) {
  try {
    const res = await fetchImpl('https://api.github.com' + path, {
      method: 'GET',
      headers: {
        'User-Agent': 'Shards-Mission-Control-Activity',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(6500),
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (!res.ok) return { ok: false, status: Number(res.status) || 502 };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, status: 502 };
  }
}

function cleanPr(item, repo) {
  const number = item?.number;
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return {
    number, draft: item?.draft === true,
    state: 'open',
    url: 'https://github.com/' + OWNER + '/' + repo + '/pull/' + number,
    created_at: safeString(item?.created_at, 35),
    updated_at: safeString(item?.updated_at, 35),
  };
}

function cleanRun(item, repo) {
  const id = item?.id;
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const goodStatus = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested', 'completed']);
  const goodConclusion = new Set(['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale']);
  const status = goodStatus.has(item?.status) ? item.status : 'unknown';
  const conclusion = goodConclusion.has(item?.conclusion) ? item.conclusion : null;
  return {
    id,
    status,
    conclusion,
    name: safeString(item?.name, 76),
    created_at: safeString(item?.created_at, 35),
    url: 'https://github.com/' + OWNER + '/' + repo + '/actions/runs/' + id,
  };
}

export async function engineeringSnapshot(fetchImpl = fetch) {
  const repos = await Promise.all(REPOSITORIES.map(async (repo) => {
    const root = '/repos/' + OWNER + '/' + repo;
    const [prResult, runResult] = await Promise.all([
      githubGet(root + '/pulls?state=open&per_page=6', fetchImpl),
      githubGet(root + '/actions/runs?branch=main&per_page=4', fetchImpl),
    ]);
    const prs = prResult.ok && Array.isArray(prResult.data)
      ? prResult.data.map(item => cleanPr(item, repo)).filter(Boolean).slice(0, 5) : null;
    const runs = runResult.ok && Array.isArray(runResult.data?.workflow_runs)
      ? runResult.data.workflow_runs.map(item => cleanRun(item, repo)).filter(Boolean).slice(0, 4) : null;
    return {
      name: repo,
      url: 'https://github.com/' + OWNER + '/' + repo,
      prs,
      has_more_prs: prResult.ok && Array.isArray(prResult.data) && prResult.data.length > 5,
      runs,
      prs_available: prs !== null,
      runs_available: runs !== null,
      error: (!prResult.ok || !runResult.ok) ? 'Some GitHub data is currently unavailable.' : null,
    };
  }));
  return {
    schema: 'shards.activity.engineering.v1',
    fetched_at: new Date().toISOString(),
    source: 'GitHub public REST API (read only)',
    upstream_cache_ttl_seconds: CACHE_SECONDS,
    repositories: repos,
    authenticated: false,
    actions_enabled: false,
  };
}


export async function cachedEngineering(env = {}, fetchImpl = fetch, now = Date.now()) {
  const store = env?.ENGINEERING_CACHE;
  let previous = null;
  if (store && typeof store.get === 'function') {
    try {
      const candidate = await store.get(CACHE_KEY, 'json');
      if (candidate?.snapshot?.schema === 'shards.activity.engineering.v1'
        && Array.isArray(candidate.snapshot.repositories)
        && candidate.snapshot.repositories.length === REPOSITORIES.length
        && Number.isSafeInteger(candidate.fresh_until)) previous = candidate;
    } catch {
      // A KV read failure must not be mistaken for a healthy upstream.
    }
  }
  if (previous?.fresh_until > now) {
    return { ...previous.snapshot, cache_status: previous.status || 'cached' };
  }

  const latest = await engineeringSnapshot(fetchImpl);
  const complete = latest.repositories.every(repo => repo.prs_available && repo.runs_available);
  let snapshot = latest;
  let status = complete ? 'verified' : 'partial';

  if (!complete && previous) {
    snapshot = { ...previous.snapshot,
      warning: 'GitHub upstream unavailable. Previously verified public snapshot shown; check fetched_at.',
      serving_stale: true };
    status = 'stale';
  }

  if (store && typeof store.put === 'function') {
    try {
      await store.put(CACHE_KEY, JSON.stringify({
        snapshot,
        status,
        fresh_until: now + (complete ? CACHE_SECONDS * 1000 : 180000),
      }), { expirationTtl: CACHE_EXPIRATION_SECONDS });
    } catch {
      // A cache write failure does not create a false health signal.
    }
  }

  return { ...snapshot, cache_status: status };
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response('Method not allowed', 'text/plain; charset=utf-8', 405);
    }
    if (url.pathname === '/api/health') {
      return json({
        service: APP_NAME, state: 'online', version: '0.1.0',
        github_access: 'public-read-only',
        discord_auth: 'not_enabled',
        agent_execution: 'not_enabled',
      });
    }
    if (url.pathname === '/api/engineering') {
      return json(await cachedEngineering(env));
    }
    if (url.pathname === '/sdk.js') {
      return sdkAsset(request, env);
    }
    if (url.pathname === '/app.js') {
      return response(request.method === 'HEAD' ? null : CLIENT_JS,
        'text/javascript; charset=utf-8', 200, 'public, max-age=300');
    }
    if (url.pathname === '/styles.css') {
      return response(request.method === 'HEAD' ? null : PAGE_CSS,
        'text/css; charset=utf-8', 200, 'public, max-age=300');
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return response(request.method === 'HEAD' ? null : PAGE_HTML,
        'text/html; charset=utf-8');
    }
    return response('Not found', 'text/plain; charset=utf-8', 404);
  },
};
