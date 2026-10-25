export const aiLimiterDefaults = Object.freeze({
  requestsPerMinute: 5,
  maxConcurrent: 2,
  maxConcurrentPerRequester: 1,
  maxConcurrentPerScope: 1,
  windowMs: 60_000,
  maxTrackedKeys: 10_000,
});

export function createAiRequestLimiter({
  requestsPerMinute = aiLimiterDefaults.requestsPerMinute,
  maxConcurrent = aiLimiterDefaults.maxConcurrent,
  maxConcurrentPerRequester = aiLimiterDefaults.maxConcurrentPerRequester,
  maxConcurrentPerScope = aiLimiterDefaults.maxConcurrentPerScope,
  windowMs = aiLimiterDefaults.windowMs,
  maxTrackedKeys = aiLimiterDefaults.maxTrackedKeys,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 60) {
    throw new Error('SHARDS_AI_REQUESTS_PER_MINUTE must be an integer from 1 to 60.');
  }
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 20) {
    throw new Error('SHARDS_AI_MAX_CONCURRENT must be an integer from 1 to 20.');
  }
  if (!Number.isInteger(maxConcurrentPerRequester) || maxConcurrentPerRequester < 1 || maxConcurrentPerRequester > 5) {
    throw new Error('maxConcurrentPerRequester must be an integer from 1 to 5.');
  }
  if (!Number.isInteger(maxConcurrentPerScope) || maxConcurrentPerScope < 1 || maxConcurrentPerScope > 20) {
    throw new Error('maxConcurrentPerScope must be an integer from 1 to 20.');
  }
  if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 3_600_000) {
    throw new Error('AI rate-limit window must be an integer from 1000 to 3600000 ms.');
  }
  if (!Number.isInteger(maxTrackedKeys) || maxTrackedKeys < 1 || maxTrackedKeys > 100_000) {
    throw new Error('maxTrackedKeys must be an integer from 1 to 100000.');
  }
  if (typeof now !== 'function') throw new Error('now must be a function.');

  const requestsByKey = new Map();
  const activeByRequester = new Map();
  const activeByScope = new Map();
  let active = 0;

  function pruneExpired(currentTime) {
    const cutoff = currentTime - windowMs;
    for (const [key, timestamps] of requestsByKey) {
      const retained = timestamps.filter(timestamp => timestamp > cutoff && timestamp <= currentTime);
      if (retained.length) requestsByKey.set(key, retained);
      else requestsByKey.delete(key);
    }
  }

  function tryAcquire(key, { requesterKey = key, scopeKey = key } = {}) {
    const validKey = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
    if (!validKey(key) || !validKey(requesterKey) || !validKey(scopeKey)) {
      throw new Error('AI limiter key must contain 1-200 characters.');
    }
    const currentTime = now();
    if (!Number.isFinite(currentTime)) throw new Error('AI limiter clock must return a finite number.');

    const cutoff = currentTime - windowMs;
    const previous = requestsByKey.get(key) ?? [];
    const timestamps = previous.filter(timestamp => timestamp > cutoff && timestamp <= currentTime);
    if (timestamps.length) requestsByKey.set(key, timestamps);
    else requestsByKey.delete(key);

    if (timestamps.length >= requestsPerMinute) {
      return {
        allowed: false,
        reason: 'rate_limit',
        retryAfterMs: Math.max(1, timestamps[0] + windowMs - currentTime),
      };
    }
    if ((activeByRequester.get(requesterKey) ?? 0) >= maxConcurrentPerRequester
      || (activeByScope.get(scopeKey) ?? 0) >= maxConcurrentPerScope
      || active >= maxConcurrent) {
      return { allowed: false, reason: 'busy', retryAfterMs: 1_000 };
    }
    if (!requestsByKey.has(key) && requestsByKey.size >= maxTrackedKeys) {
      pruneExpired(currentTime);
      if (requestsByKey.size >= maxTrackedKeys) {
        return { allowed: false, reason: 'capacity', retryAfterMs: windowMs };
      }
    }

    timestamps.push(currentTime);
    requestsByKey.set(key, timestamps);
    active += 1;
    activeByRequester.set(requesterKey, (activeByRequester.get(requesterKey) ?? 0) + 1);
    activeByScope.set(scopeKey, (activeByScope.get(scopeKey) ?? 0) + 1);
    let released = false;
    return {
      allowed: true,
      reason: null,
      retryAfterMs: 0,
      release() {
        if (released) return;
        released = true;
        active -= 1;
        const requesterCount = activeByRequester.get(requesterKey) - 1;
        if (requesterCount === 0) activeByRequester.delete(requesterKey);
        else activeByRequester.set(requesterKey, requesterCount);
        const scopeCount = activeByScope.get(scopeKey) - 1;
        if (scopeCount === 0) activeByScope.delete(scopeKey);
        else activeByScope.set(scopeKey, scopeCount);
      },
    };
  }

  return {
    tryAcquire,
    get active() { return active; },
    get limits() {
      return { requestsPerMinute, maxConcurrent, maxConcurrentPerRequester, maxConcurrentPerScope, windowMs, maxTrackedKeys };
    },
  };
}
