import { readConfig } from './config.js';
import { createBot, startBot } from './bot.js';

const client = createBot();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    client.destroy();
    process.exitCode = 0;
  });
}
try {
  const config = readConfig();
  await startBot(config, client);
} catch {
  console.error('Bot startup failed. Check environment configuration, token validity, and network access.');
  client.destroy();
  process.exitCode = 1;
}
