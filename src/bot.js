import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleInteraction } from './commands.js';
import { createTaskStore } from './tasks.js';
import { createOllamaClient } from './ollama.js';
import { createTaskWorker } from './task-worker.js';

export function createBot(logger = console, {
  taskStore = createTaskStore({ filePath: process.env.SHARDS_TASK_STORE_PATH || '.data/tasks.json' }),
  ollamaClient = createOllamaClient(),
} = {}) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [] },
  });
  const taskWorker = createTaskWorker({ taskStore, ollamaClient, logger, isRunning: () => client.isReady() });
  client.once(Events.ClientReady, ready => {
    logger.info(`Shards inc is ready (${ready.user.id}).`);
    void taskWorker.start();
  });
  client.once(Events.ClientReady, () => { client.taskWorker = taskWorker; });
  client.on(Events.InteractionCreate, interaction => {
    void handleInteraction(interaction, logger, taskStore, fetch, ollamaClient).catch(() => logger.error('Interaction processing failed.'));
  });
  client.on(Events.Error, () => logger.error('Discord client error.'));
  client.on(Events.ShardError, () => logger.error('Discord gateway connection error.'));
  return client;
}

export async function startBot(config, client = createBot()) {
  await client.login(config.token);
  return client;
}
