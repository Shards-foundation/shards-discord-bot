import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_REQUEST_LENGTH = 2_000;
const MAX_TASKS = 10_000;
const MAX_ATTEMPTS = 3;
const DEFAULT_MAX_ACTIVE_TASKS_PER_REQUESTER = 5;
const TASK_STATES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);

function validId(value, label) {
  if (typeof value !== 'string' || !/^[1-9]\d{16,19}$/.test(value)) {
    throw new Error(`${label} must be a numeric Discord snowflake.`);
  }
}

function validDatabase(data) {
  return data && data.version === 1 && Array.isArray(data.tasks) && Array.isArray(data.events)
    && data.tasks.every(task => task && typeof task.id === 'string' && TASK_STATES.has(task.state));
}

export class TaskActiveLimitError extends Error {
  constructor(limit) {
    super(`Active task limit reached (${limit}).`);
    this.name = 'TaskActiveLimitError';
    this.code = 'TASK_ACTIVE_LIMIT';
    this.limit = limit;
  }
}

function enforceActiveTaskLimit(database, requesterId, guildId, limit) {
  const activeCount = database.tasks.filter(task => task.requesterId === requesterId
    && task.guildId === guildId && (task.state === 'queued' || task.state === 'running')).length;
  if (activeCount >= limit) throw new TaskActiveLimitError(limit);
}

/**
 * Create a single-process, durable task ledger. State changes are serialized
 * and atomically replaced on disk. Deploy one bot process per data file; use a
 * shared transactional database before scaling to multiple workers or replicas.
 */
export function createTaskStore({
  filePath = '.data/tasks.json', now = () => new Date(), id = randomUUID,
  maxActiveTasksPerRequester = DEFAULT_MAX_ACTIVE_TASKS_PER_REQUESTER,
} = {}) {
  if (!Number.isInteger(maxActiveTasksPerRequester) || maxActiveTasksPerRequester < 1 || maxActiveTasksPerRequester > 100) {
    throw new Error('maxActiveTasksPerRequester must be an integer from 1 to 100.');
  }
  let database;
  let lock = Promise.resolve();

  async function withLock(operation) {
    const previous = lock;
    let release;
    lock = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function persist() {
    const directory = dirname(filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(database)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, filePath);
      const dirHandle = await open(directory, 'r');
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function ensureLoaded() {
    if (database) return;
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (!validDatabase(parsed)) throw new Error('Invalid task database schema.');
      database = parsed;
      await chmod(filePath, 0o600);
      let recovered = false;
      for (const task of database.tasks) {
        if (task.state === 'running') {
          const previousWorker = task.workerId;
          delete task.workerId;
          task.updatedAt = now().toISOString();
          if (task.attempts >= MAX_ATTEMPTS) {
            task.state = 'failed';
            task.failureCode = 'WORKER_INTERRUPTED';
            recordEvent(task, 'failed_after_retries', 'system', { previousWorker: previousWorker ?? null });
          } else {
            task.state = 'queued';
            recordEvent(task, 'requeued_after_restart', 'system', { previousWorker: previousWorker ?? null });
          }
          recovered = true;
        }
      }
      if (recovered) await persist();
    } catch (error) {
      if (error.code === 'ENOENT') {
        database = { version: 1, tasks: [], events: [] };
        await persist();
      } else {
        throw new Error('Task database is unreadable or has an unsupported schema. Back it up before repair.');
      }
    }
  }

  function recordEvent(task, action, actorId, details = {}) {
    database.events.push({
      eventId: id(), taskId: task.id, action, actorId,
      at: now().toISOString(), details,
    });
  }

  async function submit({ requesterId, guildId, request, idempotencyKey, mode = 'chat' }) {
    validId(requesterId, 'requesterId');
    validId(guildId, 'guildId');
    if (typeof request !== 'string' || !request.trim() || request.length > MAX_REQUEST_LENGTH) {
      throw new Error(`request must contain 1-${MAX_REQUEST_LENGTH} characters.`);
    }
    if (!['chat', 'github_research'].includes(mode)) throw new Error('mode must be chat or github_research.');
    if (typeof idempotencyKey !== 'string' || !/^[\w-]{8,100}$/.test(idempotencyKey)) {
      throw new Error('idempotencyKey must contain 8-100 letters, digits, underscores, or hyphens.');
    }
    return withLock(async () => {
      await ensureLoaded();
      const existing = database.tasks.find(task => task.guildId === guildId
        && task.requesterId === requesterId && task.idempotencyKey === idempotencyKey);
      if (existing) return structuredClone(existing);
      enforceActiveTaskLimit(database, requesterId, guildId, maxActiveTasksPerRequester);
      if (database.tasks.length >= MAX_TASKS) throw new Error('Task capacity reached; operator maintenance is required.');
      const at = now().toISOString();
      const task = {
        id: id(), requesterId, guildId, request: request.trim(), idempotencyKey, mode,
        state: 'queued', createdAt: at, updatedAt: at, attempts: 0,
        result: null, failureCode: null,
      };
      database.tasks.push(task);
      recordEvent(task, 'submitted', requesterId);
      await persist();
      return structuredClone(task);
    });
  }

  async function claimNext(workerId) {
    if (typeof workerId !== 'string' || !/^[\w.-]{1,80}$/.test(workerId)) throw new Error('Invalid workerId.');
    return withLock(async () => {
      await ensureLoaded();
      const task = database.tasks.find(item => item.state === 'queued' && item.attempts < MAX_ATTEMPTS);
      if (!task) return null;
      task.state = 'running';
      task.workerId = workerId;
      task.attempts += 1;
      task.updatedAt = now().toISOString();
      recordEvent(task, 'claimed', workerId, { attempt: task.attempts });
      await persist();
      return structuredClone(task);
    });
  }

  async function finish(taskId, workerId, { result = null, failureCode = null } = {}) {
    if (typeof result !== 'string' && result !== null) throw new Error('result must be a string or null.');
    if (result !== null && result.length > 4_000) throw new Error('result must not exceed 4000 characters.');
    if (failureCode !== null && (typeof failureCode !== 'string' || !/^[A-Z0-9_]{1,40}$/.test(failureCode))) {
      throw new Error('failureCode must be a short uppercase code.');
    }
    return withLock(async () => {
      await ensureLoaded();
      const task = database.tasks.find(item => item.id === taskId);
      if (!task || task.state !== 'running' || task.workerId !== workerId) throw new Error('Task is not owned by this active worker.');
      task.state = failureCode ? 'failed' : 'completed';
      task.result = result;
      task.failureCode = failureCode;
      task.updatedAt = now().toISOString();
      recordEvent(task, failureCode ? 'failed' : 'completed', workerId, failureCode ? { failureCode } : {});
      await persist();
      return structuredClone(task);
    });
  }

  async function cancel(taskId, actorId, { guildId, isOperator = false } = {}) {
    validId(actorId, 'actorId');
    if (guildId !== undefined) validId(guildId, 'guildId');
    return withLock(async () => {
      await ensureLoaded();
      const task = database.tasks.find(item => item.id === taskId);
      if (!task) return null;
      if ((task.requesterId !== actorId || (guildId && task.guildId !== guildId)) && !isOperator) {
        throw new Error('Not authorised to cancel this task.');
      }
      if (task.state !== 'queued') throw new Error('Only queued tasks can be cancelled.');
      task.state = 'cancelled';
      task.updatedAt = now().toISOString();
      recordEvent(task, 'cancelled', actorId);
      await persist();
      return structuredClone(task);
    });
  }

  async function retry(taskId, actorId, { guildId, isOperator = false } = {}) {
    validId(actorId, 'actorId');
    if (guildId !== undefined) validId(guildId, 'guildId');
    return withLock(async () => {
      await ensureLoaded();
      const task = database.tasks.find(item => item.id === taskId);
      if (!task) return null;
      if ((task.requesterId !== actorId || (guildId && task.guildId !== guildId)) && !isOperator) throw new Error('Not authorised to retry this task.');
      if (task.state !== 'failed') throw new Error('Only failed tasks can be retried.');
      if (task.attempts >= MAX_ATTEMPTS) throw new Error('Task attempt limit reached; submit a new request.');
      enforceActiveTaskLimit(database, task.requesterId, task.guildId, maxActiveTasksPerRequester);
      task.state = 'queued'; task.result = null; task.failureCode = null; task.updatedAt = now().toISOString();
      recordEvent(task, 'retry_requested', actorId, { previousAttempts: task.attempts });
      await persist();
      return structuredClone(task);
    });
  }

  async function get(taskId, actorId, { guildId, isOperator = false } = {}) {
    validId(actorId, 'actorId');
    if (guildId !== undefined) validId(guildId, 'guildId');
    return withLock(async () => {
      await ensureLoaded();
      const task = database.tasks.find(item => item.id === taskId);
      if (!task || ((task.requesterId !== actorId || (guildId && task.guildId !== guildId)) && !isOperator)) return null;
      return structuredClone(task);
    });
  }

  async function events(taskId, actorId, { guildId, isOperator = false } = {}) {
    const task = await get(taskId, actorId, { guildId, isOperator });
    if (!task) return null;
    return withLock(async () => {
      await ensureLoaded();
      return structuredClone(database.events.filter(event => event.taskId === taskId));
    });
  }

  return { submit, claimNext, finish, cancel, retry, get, events, maxActiveTasksPerRequester };
}
