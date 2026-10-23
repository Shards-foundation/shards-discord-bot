import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleInteraction } from './commands.js';

export function createBot(logger = console) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [] },
  });
  client.once(Events.ClientReady, ready => logger.info(`Shards inc is ready (${ready.user.id}).`));
  client.on(Events.InteractionCreate, interaction => {
    void handleInteraction(interaction, logger).catch(() => logger.error('Interaction processing failed.'));
  });
  client.on(Events.Error, () => logger.error('Discord client error.'));
  client.on(Events.ShardError, () => logger.error('Discord gateway connection error.'));
  return client;
}

export async function startBot(config, client = createBot()) {
  await client.login(config.token);
  return client;
}
