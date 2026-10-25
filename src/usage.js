import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_RECORDS = 20_000;
const SOURCES = new Set(['ai_chat', 'ai_research', 'task_chat', 'task_research']);

function validDiscordId(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^[1-9]\d{16,19}$/.test(value)) {
    throw new Error(`${label} must be a Discord snowflake${nullable ? ' or null' : ''}.`);
  }
}

function validMetric(value, label) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be null or a non-negative integer.`);
  }
}

function isUsageRecord(record) {
  const snowflake = value => typeof value === 'string' && /^[1-9]\d{16,19}$/.test(value);
  const metric = value => value === null || (Number.isSafeInteger(value) && value >= 0);
  return record && typeof record.id === 'string' && record.id.length <= 100
    && snowflake(record.actorId) && (record.guildId === null || snowflake(record.guildId))
    && (record.taskId === null || (typeof record.taskId === 'string' && record.taskId.length <= 100))
    && SOURCES.has(record.source) && typeof record.model === 'string' && record.model.length > 0 && record.model.length <= 120
    && metric(record.promptTokens) && metric(record.completionTokens) && metric(record.durationNs)
    && typeof record.at === 'string' && Number.isFinite(Date.parse(record.at));
}

export function createUsageStore({ filePath = '.data/usage.json', now = () => new Date(), id = randomUUID, maxRecords = MAX_RECORDS } = {}) {
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_RECORDS) {
    throw new Error(`maxRecords must be an integer from 1 to ${MAX_RECORDS}.`);
  }
  let database;
  let lock = Promise.resolve();

  async function withLock(operation) {
    const previous = lock;
    let release;
    lock = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
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
      const directoryHandle = await open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
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
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)
        || typeof parsed.historyTruncated !== 'boolean' || !parsed.records.every(isUsageRecord)) {
        throw new Error('Invalid usage database schema.');
      }
      database = parsed;
      await chmod(filePath, 0o600);
    } catch (error) {
      if (error.code === 'ENOENT') {
        database = { version: 1, records: [], historyTruncated: false };
        await persist();
      } else {
        throw new Error('Usage database is unreadable or has an unsupported schema. Back it up before repair.');
      }
    }
  }

  async function record({ actorId, guildId = null, taskId = null, source, model, promptTokens = null, completionTokens = null, durationNs = null }) {
    validDiscordId(actorId, 'actorId');
    validDiscordId(guildId, 'guildId', true);
    if (taskId !== null && (typeof taskId !== 'string' || taskId.length > 100)) throw new Error('taskId must be null or a short task identifier.');
    if (!SOURCES.has(source)) throw new Error('Unsupported usage source.');
    if (typeof model !== 'string' || !model.trim() || model.length > 120) throw new Error('model must contain 1-120 characters.');
    validMetric(promptTokens, 'promptTokens');
    validMetric(completionTokens, 'completionTokens');
    validMetric(durationNs, 'durationNs');
    return withLock(async () => {
      await ensureLoaded();
      if (database.records.length >= maxRecords) {
        database.records.shift();
        database.historyTruncated = true;
      }
      database.records.push({
        id: id(), actorId, guildId, taskId, source, model: model.trim(),
        promptTokens, completionTokens, durationNs, at: now().toISOString(),
      });
      await persist();
    });
  }

  async function summary(actorId, guildId) {
    validDiscordId(actorId, 'actorId');
    validDiscordId(guildId, 'guildId', true);
    return withLock(async () => {
      await ensureLoaded();
      const records = database.records.filter(record => record.actorId === actorId && record.guildId === guildId);
      const measured = records.filter(record => record.promptTokens !== null && record.completionTokens !== null);
      return {
        requests: records.length,
        measuredRequests: measured.length,
        promptTokens: measured.reduce((sum, record) => sum + record.promptTokens, 0),
        completionTokens: measured.reduce((sum, record) => sum + record.completionTokens, 0),
        durationNs: records.reduce((sum, record) => sum + (record.durationNs ?? 0), 0),
        models: records.reduce((counts, record) => {
          counts[record.model] = (counts[record.model] ?? 0) + 1;
          return counts;
        }, {}),
        historyTruncated: database.historyTruncated,
      };
    });
  }

  return { record, summary };
}
