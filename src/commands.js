import { randomInt } from 'node:crypto';
import { ApplicationCommandOptionType, ApplicationCommandType, MessageFlags } from 'discord.js';

export const commands = [
  { name: 'ping', description: 'Check bot responsiveness and gateway latency.', type: ApplicationCommandType.ChatInput },
  { name: 'hello', description: 'Get a friendly greeting from Shards inc.', type: ApplicationCommandType.ChatInput },
  { name: 'help', description: 'Show available Shards bot commands.', type: ApplicationCommandType.ChatInput },
  { name: 'roll', description: 'Roll a fair die with the chosen number of sides.', type: ApplicationCommandType.ChatInput,
    options: [{ type: ApplicationCommandOptionType.Integer, name: 'sides', description: 'Number of sides (2–1000).', required: false, min_value: 2, max_value: 1000 }] },
  { name: 'choose', description: 'Choose one option at random from a comma-separated list.', type: ApplicationCommandType.ChatInput,
    options: [{ type: ApplicationCommandOptionType.String, name: 'options', description: 'Enter 2–20 options separated by commas.', required: true, max_length: 500 }] },
  { name: 'coinflip', description: 'Flip a fair coin.', type: ApplicationCommandType.ChatInput },
  {
    name: 'system',
    description: 'Inspect bot runtime status.',
    type: ApplicationCommandType.ChatInput,
    options: [{
      type: ApplicationCommandOptionType.Subcommand,
      name: 'status',
      description: 'Show current process and Discord connection health.',
    }],
  },
  {
    name: 'task',
    description: 'Submit and track your durable task requests.',
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'submit',
        description: 'Store a task request in the durable queue.',
        options: [{
          type: ApplicationCommandOptionType.String,
          name: 'request',
          description: 'Task request (stored for the configured worker).',
          required: true,
          min_length: 1,
          max_length: 2_000,
        }],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'status',
        description: 'Inspect one of your task requests.',
        options: [{
          type: ApplicationCommandOptionType.String,
          name: 'task_id',
          description: 'ID returned by /task submit.',
          required: true,
        }],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'cancel',
        description: 'Cancel a task that is still queued.',
        options: [{
          type: ApplicationCommandOptionType.String,
          name: 'task_id',
          description: 'ID returned by /task submit.',
          required: true,
        }],
      },
    ],
  },
];

function formatStatus(client) {
  const ready = client.isReady();
  const ping = client.ws.ping;
  const latency = Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)} ms` : 'unavailable';
  const uptimeSeconds = Math.floor(process.uptime());
  const uptime = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;
  return [
    `Discord connection: ${ready ? 'ready' : 'not ready'}`,
    `Gateway latency: ${latency}`,
    'Task executor: not configured (submitted requests remain queued)',
    `Process uptime: ${uptime}`,
    `Runtime: Node.js ${process.versions.node}`,
  ].join('\n');
}

async function handleTaskCommand(interaction, taskStore) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Task requests are available only inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  let content;
  if (subcommand === 'submit') {
    const task = await taskStore.submit({
      requesterId: interaction.user.id,
      guildId: interaction.guildId,
      request: interaction.options.getString('request', true),
      idempotencyKey: interaction.id,
    });
    content = `Task ${task.id} was saved to the durable queue (status: ${task.state}). No task executor is configured, so the request has not been processed.`;
  } else {
    const taskId = interaction.options.getString('task_id', true);
    if (subcommand === 'status') {
      const task = await taskStore.get(taskId, interaction.user.id, { guildId: interaction.guildId });
      content = task
        ? `Task ${task.id}: ${task.state}${task.failureCode ? ` (${task.failureCode})` : ''}${task.result ? `\nResult: ${task.result}` : ''}`
        : 'Task not found or you are not authorised to view it.';
    } else if (subcommand === 'cancel') {
      const task = await taskStore.cancel(taskId, interaction.user.id, { guildId: interaction.guildId });
      content = task ? `Task ${task.id} cancelled.` : 'Task not found or you are not authorised to cancel it.';
    } else {
      content = 'Unsupported task operation.';
    }
  }
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

const HELP_TEXT = [
  '**Shards bot commands**',
  '`/ping` — gateway latency check',
  '`/hello` — greeting',
  '`/system status` — runtime and connection status',
  '`/task submit`, `/task status`, `/task cancel` — durable task intake and tracking (no executor configured)',
  '`/roll [sides]` — roll a die (2–1000 sides; defaults to 6)',
  '`/choose options` — randomly select from 2–20 comma-separated options',
  '`/coinflip` — heads or tails',
  '`/help` — this command list',
].join('\n');

function chooseOption(raw) {
  const options = raw.split(',').map(option => option.trim()).filter(Boolean);
  if (options.length < 2 || options.length > 20) return { error: 'Provide between 2 and 20 non-empty options, separated by commas.' };
  return { value: options[randomInt(options.length)] };
}

export async function handleInteraction(interaction, logger = console, taskStore) {
  if (!interaction.isChatInputCommand()) return;
  const supported = ['ping', 'hello', 'help', 'roll', 'choose', 'coinflip', 'system', 'task'].includes(interaction.commandName);
  if (!supported) return;
  try {
    let content;
    if (interaction.commandName === 'ping') {
      const ping = interaction.client.ws.ping;
      const latency = Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)} ms` : 'unavailable';
      content = `Pong! Gateway latency: ${latency}.`;
    } else if (interaction.commandName === 'hello') {
      content = `Hello, ${interaction.user.username}! Welcome to Shards inc.`;
    } else if (interaction.commandName === 'help') {
      content = HELP_TEXT;
    } else if (interaction.commandName === 'roll') {
      const sides = interaction.options.getInteger('sides') ?? 6;
      content = !Number.isInteger(sides) || sides < 2 || sides > 1000
        ? 'Choose a die with between 2 and 1000 sides.'
        : `🎲 You rolled **${randomInt(1, sides + 1)}** on a d${sides}.`;
    } else if (interaction.commandName === 'choose') {
      const result = chooseOption(interaction.options.getString('options') ?? '');
      content = result.error ?? `I choose: **${result.value}**`;
    } else if (interaction.commandName === 'coinflip') {
      content = randomInt(2) === 0 ? '🪙 Heads.' : '🪙 Tails.';
    } else if (interaction.commandName === 'task') {
      if (!taskStore) throw new Error('Task store is unavailable.');
      await handleTaskCommand(interaction, taskStore);
      return;
    } else if (interaction.options.getSubcommand() === 'status') {
      content = formatStatus(interaction.client);
    } else {
      return;
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
