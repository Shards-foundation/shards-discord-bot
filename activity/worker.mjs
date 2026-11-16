import { PAGE_HTML, PAGE_CSS } from './ui.mjs';
import { CLIENT_JS } from './client.mjs';

const REPOSITORIES = Object.freeze(['shards-discord-bot', 'Shards-kernel', 'Shards-MCP']);
const OWNER = 'Shards-foundation';
const APP_NAME = 'Shards Mission Control';
const ALLOWED = new Set(REPOSITORIES);
const CACHE_SECONDS = 1800;
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@2.5.0/+esm';
const CDN_BASE = 'https://cdn.jsdelivr.net';
const CDN_PATH_PATTERN = /^\/npm\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@[a-z0-9._-]+\/\+esm$/i;

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
  return response(JSON.stringify(body), 'application/json; charset=utf-8', status, 'public, max-age=30, s-maxage=75');
}

function safeString(value, max = 100) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function vendorUpstreamFor(pathname) {
  if (pathname === '/sdk.js') return SDK_URL;
  if (pathname.length <= 190 && CDN_PATH_PATTERN.test(pathname)) return CDN_BASE + pathname;
  return null;
}

async function vendorModule(pathname, fetchImpl = fetch) {
  const upstream = vendorUpstreamFor(pathname);
  if (!upstream) return response('Not found', 'text/plain; charset=utf-8', 404);
  try {
    const res = await fetchImpl(upstream, {
      method: 'GET',
      headers: { Accept: 'text/javascript' },
      redirect: 'error',
      signal: AbortSignal.timeout(9000),
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return response('SDK dependency temporarily unavailable', 'text/plain; charset=utf-8', 502);
    const script = await res.text();
    if (script.length > 1200000) return response('SDK dependency too large', 'text/plain; charset=utf-8', 502);
    return response(script, 'text/javascript; charset=utf-8', 200, 'public, max-age=86400');
  } catch {
    return response('SDK dependency temporarily unavailable', 'text/plain; charset=utf-8', 502);
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

export default {
  async fetch(request) {
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
      return json(await engineeringSnapshot());
    }
    if (vendorUpstreamFor(url.pathname)) {
      return vendorModule(url.pathname);
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
