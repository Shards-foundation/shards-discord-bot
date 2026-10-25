import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiRequestLimiter } from '../src/ai-limiter.js';

test('applies a rolling per-requester request limit and reports retry time', () => {
  let time = 10_000;
  const limiter = createAiRequestLimiter({ requestsPerMinute: 2, maxConcurrent: 3, now: () => time });
  const first = limiter.tryAcquire('guild-a:user-a');
  first.release();
  limiter.tryAcquire('guild-a:user-a').release();

  const limited = limiter.tryAcquire('guild-a:user-a');
  assert.equal(limited.allowed, false);
  assert.equal(limited.reason, 'rate_limit');
  assert.equal(limited.retryAfterMs, 60_000);

  time += 60_000;
  const afterWindow = limiter.tryAcquire('guild-a:user-a');
  assert.equal(afterWindow.allowed, true);
  afterWindow.release();
});

test('isolates requester keys and bounds concurrent model work across the process', () => {
  const limiter = createAiRequestLimiter({ requestsPerMinute: 5, maxConcurrent: 1 });
  const first = limiter.tryAcquire('guild-a:user-a');
  const busy = limiter.tryAcquire('guild-a:user-b');
  assert.equal(first.allowed, true);
  assert.equal(busy.allowed, false);
  assert.equal(busy.reason, 'busy');
  assert.equal(limiter.active, 1);

  first.release();
  first.release();
  assert.equal(limiter.active, 0);
  const second = limiter.tryAcquire('guild-a:user-b');
  assert.equal(second.allowed, true);
  second.release();

  const otherGuild = limiter.tryAcquire('guild-b:user-a');
  assert.equal(otherGuild.allowed, true);
  otherGuild.release();
});

test('one requester or server cannot occupy all direct-model concurrency slots', () => {
  const limiter = createAiRequestLimiter({ maxConcurrent: 2 });
  const first = limiter.tryAcquire('guild-a:user-a', { requesterKey: 'user-a', scopeKey: 'guild-a' });
  const sameRequester = limiter.tryAcquire('guild-b:user-a', { requesterKey: 'user-a', scopeKey: 'guild-b' });
  const sameGuild = limiter.tryAcquire('guild-a:user-b', { requesterKey: 'user-b', scopeKey: 'guild-a' });
  const independent = limiter.tryAcquire('guild-b:user-b', { requesterKey: 'user-b', scopeKey: 'guild-b' });

  assert.equal(first.allowed, true);
  assert.equal(sameRequester.allowed, false);
  assert.equal(sameRequester.reason, 'busy');
  assert.equal(sameGuild.allowed, false);
  assert.equal(independent.allowed, true);
  assert.equal(limiter.limits.maxConcurrentPerRequester, 1);
  assert.equal(limiter.limits.maxConcurrentPerScope, 1);

  first.release();
  independent.release();
  assert.equal(limiter.active, 0);
});

test('prunes expired requester keys before rejecting new keys at the memory bound', () => {
  let time = 1_000;
  const limiter = createAiRequestLimiter({ requestsPerMinute: 2, maxConcurrent: 2, windowMs: 1_000, maxTrackedKeys: 1, now: () => time });
  limiter.tryAcquire('guild-a:user-a').release();
  const full = limiter.tryAcquire('guild-a:user-b');
  assert.equal(full.allowed, false);
  assert.equal(full.reason, 'capacity');

  time += 1_000;
  const reclaimed = limiter.tryAcquire('guild-a:user-b');
  assert.equal(reclaimed.allowed, true);
  reclaimed.release();
});

test('validates configured limits and requester keys', () => {
  assert.throws(() => createAiRequestLimiter({ requestsPerMinute: 0 }), /SHARDS_AI_REQUESTS_PER_MINUTE/);
  assert.throws(() => createAiRequestLimiter({ maxConcurrent: 21 }), /SHARDS_AI_MAX_CONCURRENT/);
  assert.throws(() => createAiRequestLimiter({ maxTrackedKeys: 0 }), /maxTrackedKeys/);
  const limiter = createAiRequestLimiter();
  assert.throws(() => limiter.tryAcquire(''), /limiter key/);
  assert.throws(() => limiter.tryAcquire('x'.repeat(201)), /limiter key/);
});
