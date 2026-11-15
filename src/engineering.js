// Read-only GitHub engineering snapshots. No GitHub write token or model needed.
export const PUBLIC_SHARDS_PROJECTS = Object.freeze([
  'shards-discord-bot',
  'Shards-kernel',
  'Shards-MCP',
]);

const cache = new Map();
const TTL_MS = 60_000;
const SAFE_STATES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested']);
const SAFE_CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale']);

function safeState(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : 'unknown';
}

async function readApi(path, fetchImpl) {
  try {
    const response = await fetchImpl('https://api.github.com' + path, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Shards-Discord-Bot' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function freshSnapshot(project, fetchImpl) {
  const path = '/repos/Shards-foundation/' + project;
  const [pullData, runData] = await Promise.all([
    readApi(path + '/pulls?state=open&per_page=5', fetchImpl),
    readApi(path + '/actions/runs?branch=main&per_page=1', fetchImpl),
  ]);
  const root = 'https://github.com/Shards-foundation/' + project;
  const lines = ['**Shards engineering · ' + project + '**', root];
  if (Array.isArray(pullData)) {
    const items = pullData.filter(p => Number.isSafeInteger(p?.number) && p.number > 0).slice(0, 5);
    lines.push(items.length ? 'Newest open PRs:' : 'Open PRs: none returned');
    for (const pr of items) {
      lines.push('• #' + pr.number + (pr.draft === true ? ' (draft)' : '') + ' — ' + root + '/pull/' + pr.number);
    }
    if (pullData.length >= 5) lines.push('Other open PRs may exist; showing up to five.');
  } else {
    lines.push('PR data: unavailable or GitHub API rate-limited');
  }
  const runs = runData?.workflow_runs;
  if (Array.isArray(runs)) {
    const run = runs.find(r => Number.isSafeInteger(r?.id) && r.id > 0);
    if (run) {
      lines.push('Latest main-branch workflow: '
        + safeState(run.status, SAFE_STATES)
        + (run.status === 'completed' ? ' / ' + safeState(run.conclusion, SAFE_CONCLUSIONS) : ''));
      lines.push(root + '/actions/runs/' + run.id);
    } else {
      lines.push('Recent main-branch workflow: none returned');
    }
  } else {
    lines.push('Workflow data: unavailable or GitHub API rate-limited');
  }
  lines.push('Read-only public metadata. No AI runtime or GitHub write access is required.');
  return { ok: true, content: lines.join('\n') };
}

export async function getShardsEngineeringSnapshot(project, fetchImpl = fetch) {
  if (!PUBLIC_SHARDS_PROJECTS.includes(project)) {
    return { ok: false, content: 'This project is not on the public Shards allowlist. Private repositories need a separate authenticated integration.' };
  }
  // Test callers and alternate fetch providers bypass shared process-local cache.
  if (fetchImpl !== fetch) return freshSnapshot(project, fetchImpl);
  const cached = cache.get(project);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = freshSnapshot(project, fetchImpl);
  cache.set(project, { expiresAt: Date.now() + TTL_MS, promise });
  return promise;
}
