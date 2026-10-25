import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleInteraction } from './commands.js';
import { createTaskStore } from './tasks.js';
import { createOllamaClient } from './ollama.js';
import { createTaskWorker } from './task-worker.js';
import { createUsageStore } from './usage.js';

export function createBot(logger = console, {
  taskStore = createTaskStore({ filePath: process.env.SHARDS_TASK_STORE_PATH || '.data/tasks.json' }),
  ollamaClient = createOllamaClient(),
  usageStore = createUsageStore({ filePath: process.env.SHARDS_USAGE_STORE_PATH || '.data/usage.json' }),
} = {}) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [] },
  });
  const taskWorker = createTaskWorker({ taskStore, ollamaClient, usageStore, logger });
  client.once(Events.ClientReady, ready => {
    logger.info(`Shards inc is ready (${ready.user.id}).`);
    void taskWorker.start();
  });
  client.once(Events.ClientReady, () => { client.taskWorker = taskWorker; });
  client.on(Events.InteractionCreate, interaction => {
    void handleInteraction(interaction, logger, taskStore, fetch, ollamaClient, usageStore).catch(() => logger.error('Interaction processing failed.'));
  });
  client.on(Events.Error, () => logger.error('Discord client error.'));
  client.on(Events.ShardError, () => logger.error('Discord gateway connection error.'));
  return client;
}

export async function startBot(config, client = createBot()) {
  await client.login(config.token);
  return client;
}
