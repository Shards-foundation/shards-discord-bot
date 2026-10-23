import { ApplicationCommandType, MessageFlags } from 'discord.js';

export const commands = [
  { name: 'ping', description: 'Check bot responsiveness and gateway latency.', type: ApplicationCommandType.ChatInput },
  { name: 'hello', description: 'Get a friendly greeting from Shards inc.', type: ApplicationCommandType.ChatInput },
];

export async function handleInteraction(interaction, logger = console) {
  if (!interaction.isChatInputCommand()) return;
  if (!commands.some(command => command.name === interaction.commandName)) return;
  try {
    let content;
    if (interaction.commandName === 'ping') {
      const ping = interaction.client.ws.ping;
      const latency = Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)} ms` : 'unavailable';
      content = `Pong! Gateway latency: ${latency}.`;
    } else {
      content = `Hello, ${interaction.user.username}! Welcome to Shards inc.`;
    }
    await interaction.reply({ content, allowedMentions: { parse: [] } });
  } catch {
    // Never log raw Discord errors: request metadata may contain credentials.
    logger.error('Slash command failed.');
    const fallback = {
      content: 'Something went wrong. Please try again later.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(fallback);
      else await interaction.reply(fallback);
    } catch {
      logger.error('Unable to send the private error response.');
    }
  }
}
