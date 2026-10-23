import { readConfig } from './config.js';
import { createBot, startBot } from './bot.js';
import { createShutdownHandler } from './shutdown.js';

const client = createBot();
const shutdown = createShutdownHandler(client, { onComplete: code => { process.exitCode = code; } });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void shutdown(signal); });
}

try {
  const config = readConfig();
  await startBot(config, client);
} catch {
  console.error('Bot startup failed. Check environment configuration, token validity, and network access.');
  await shutdown('startup failure');
  process.exitCode = 1;
}
