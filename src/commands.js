import { randomInt } from 'node:crypto';
import { ApplicationCommandOptionType, ApplicationCommandType, MessageFlags } from 'discord.js';

const chat = ApplicationCommandType.ChatInput;
const integer = ApplicationCommandOptionType.Integer;
const string = ApplicationCommandOptionType.String;

export const commands = [
  { name: 'ping', description: 'Check bot responsiveness and gateway latency.', type: chat },
  { name: 'hello', description: 'Get a greeting from Shards.', type: chat },
  { name: 'help', description: 'Show available Shards bot commands.', type: chat },
  { name: 'status', description: 'Show the bot runtime and connection status.', type: chat },
  {
    name: 'roll',
    description: 'Roll a fair die with the chosen number of sides.',
    type: chat,
    options: [{ type: integer, name: 'sides', description: 'Number of sides (2–1000).', required: false, min_value: 2, max_value: 1000 }],
  },
  {
    name: 'choose',
    description: 'Choose one option at random from a comma-separated list.',
    type: chat,
    options: [{ type: string, name: 'options', description: 'Enter 2–20 options separated by commas.', required: true, max_length: 500 }],
  },
  { name: 'coinflip', description: 'Flip a fair coin.', type: chat },
];

const HELP_TEXT = [
  '**Shards bot commands**',
  '`/ping` — gateway latency check',
  '`/hello` — greeting',
  '`/status` — runtime status, uptime and server count',
  '`/roll [sides]` — roll a die (2–1000 sides; defaults to 6)',
  '`/choose options` — randomly select from 2–20 comma-separated options',
  '`/coinflip` — heads or tails',
  '`/help` — this command list',
].join('\n');

function gatewayLatency(client) {
  const ping = client?.ws?.ping;
  return Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)} ms` : 'unavailable';
}

function chooseOption(raw) {
  const options = raw.split(',').map(option => option.trim()).filter(Boolean);
  if (options.length < 2 || options.length > 20) {
    return { error: 'Provide between 2 and 20 non-empty options, separated by commas.' };
  }
  return { value: options[randomInt(options.length)] };
}

export async function handleInteraction(interaction, logger = console) {
  if (!interaction.isChatInputCommand()) return;
  if (!commands.some(command => command.name === interaction.commandName)) return;
  try {
    let content;
    switch (interaction.commandName) {
      case 'ping':
        content = `Pong! Gateway latency: ${gatewayLatency(interaction.client)}.`;
        break;
      case 'hello':
        content = `Hello, ${interaction.user.username}! Welcome to Shards.`;
        break;
      case 'help':
        content = HELP_TEXT;
        break;
      case 'status': {
        const uptime = Math.max(0, Math.floor(process.uptime()));
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        const guildCount = interaction.client?.guilds?.cache?.size;
        content = [
          '**Shards bot status**',
          `Gateway latency: ${gatewayLatency(interaction.client)}`,
          `Connected servers: ${Number.isInteger(guildCount) ? guildCount : 'unavailable'}`,
          `Process uptime: ${hours}h ${minutes}m ${seconds}s`,
        ].join('\n');
        break;
      }
      case 'roll': {
        const sides = interaction.options.getInteger('sides') ?? 6;
        if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
          content = 'Choose a die with between 2 and 1000 sides.';
          break;
        }
        content = `🎲 You rolled **${randomInt(1, sides + 1)}** on a d${sides}.`;
        break;
      }
      case 'choose': {
        const result = chooseOption(interaction.options.getString('options') ?? '');
        content = result.error ?? `I choose: **${result.value}**`;
        break;
      }
      case 'coinflip':
        content = randomInt(2) === 0 ? '🪙 Heads.' : '🪙 Tails.';
        break;
      default:
        return;
    }
    await interaction.reply({ content, allowedMentions: { parse: [] } });
  } catch {
    // Never log raw Discord errors: request metadata may contain credentials.
    logger.error('Interaction processing failed.');
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
