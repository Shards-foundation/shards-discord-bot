import { randomInt } from 'node:crypto';
import { createOllamaClient } from './ollama.js';
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
    name: 'github',
    description: 'Look up a public GitHub repository.',
    type: ApplicationCommandType.ChatInput,
    options: [{
      type: ApplicationCommandOptionType.Subcommand,
      name: 'repo',
      description: 'Show public repository details.',
      options: [{
        type: ApplicationCommandOptionType.String,
        name: 'repository',
        description: 'Repository in owner/name format.',
        required: true,
        max_length: 140,
      }],
    }],
  },
  {
    name: 'ai',
    description: 'Ask the local Qwen model through Ollama.',
    type: ApplicationCommandType.ChatInput,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'ask',
        description: 'Send a prompt to the configured Qwen model.',
        options: [{
          type: ApplicationCommandOptionType.String,
          name: 'prompt',
          description: 'What should Shards AI help with?',
          required: true,
          min_length: 1,
          max_length: 3000,
        }],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'status',
        description: 'Check Ollama connectivity and whether the configured model is installed.',
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'models',
        description: 'List locally available Ollama models.',
      },
    ],
  },
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

async function handleAICommand(interaction, ollamaClient) {
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let content;
  if (subcommand === 'ask') {
    const prompt = interaction.options.getString('prompt', true);
    const answer = await ollamaClient.chat(prompt);
    const responseText = answer.content.length > 1_750 ? answer.content.slice(0, 1_730) + '\n\n[Response truncated for Discord.]' : answer.content;
    const seconds = answer.totalDurationNs === null ? 'unknown' : (answer.totalDurationNs / 1e9).toFixed(1) + 's';
    content = '**Shards AI · ' + answer.model + ' · ' + seconds + '**\n' + responseText;
  } else {
    const models = await ollamaClient.listModels();
    const installed = models.some(item => item.name === ollamaClient.model
      || item.name.split(':')[0] === ollamaClient.model.split(':')[0]);
    if (subcommand === 'status') {
      content = [
        'Ollama API: reachable',
        'Configured model: ' + ollamaClient.model,
        'Model installed: ' + (installed ? 'yes' : 'no'),
        'Available models: ' + models.length,
        ...(installed ? [] : ['Install it with: ollama pull ' + ollamaClient.model]),
      ].join('\n');
    } else {
      content = models.length
        ? '**Ollama models (' + models.length + ')**\n' + models.map(item => '• ' + item.name + (item.size ? ' · ' + (item.size / 1e9).toFixed(1) + ' GB' : '')).join('\n')
        : 'Ollama is reachable, but no models are installed. Install the configured model first.';
    }
  }
  await interaction.editReply({ content: content.slice(0, 1_950), allowedMentions: { parse: [] } });
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
  '`/github repo owner/name` — public GitHub repository metadata',
  '`/ai ask prompt` — send a prompt to the configured Qwen model through Ollama',
  '`/ai status` and `/ai models` — check Ollama and installed models',
  '`/help` — this command list',
].join('\n');

export async function lookupPublicRepository(repository, fetchImpl = fetch) {
  if (typeof repository !== 'string' || repository.length > 140) {
    return { ok: false, content: 'Enter a public repository as owner/name.' };
  }
  const [owner, name, extra] = repository.trim().split('/');
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner ?? '');
  const validName = /^[A-Za-z0-9._-]{1,100}$/.test(name ?? '');
  if (!validOwner || !validName || extra !== undefined) {
    return { ok: false, content: 'Invalid repository format. Use owner/name (letters, numbers, dots, hyphens or underscores).' };
  }
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Shards-Discord-Bot' },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) return { ok: false, content: 'Repository not found or not publicly accessible.' };
    if (response.status === 403 || response.status === 429) return { ok: false, content: 'GitHub API rate limit reached. Try again later.' };
    if (!response.ok) return { ok: false, content: 'GitHub lookup is temporarily unavailable.' };
    const data = await response.json();
    if (typeof data.full_name !== 'string' || !Number.isFinite(data.stargazers_count)) {
      return { ok: false, content: 'GitHub returned an unexpected repository response.' };
    }
    const language = typeof data.language === 'string' ? data.language : 'Not specified';
    const description = typeof data.description === 'string' && data.description.trim()
      ? data.description.trim().replace(/[\\r\\n\\t]/g, ' ').replace(/[*_~|<>]/g, '').replaceAll('`', '').slice(0, 180)
      : 'No description provided.';
    return {
      ok: true,
      content: [
        `**${data.full_name}**`,
        description,
        `Stars: ${data.stargazers_count.toLocaleString('en-GB')} · Forks: ${Number(data.forks_count || 0).toLocaleString('en-GB')} · Open issues: ${Number(data.open_issues_count || 0).toLocaleString('en-GB')}`,
        `Primary language: ${language}`,
        `https://github.com/${owner}/${name}`,
      ].join('\\n'),
    };
  } catch {
    return { ok: false, content: 'GitHub lookup timed out or could not connect. Try again later.' };
  }
}

function chooseOption(raw) {
  const options = raw.split(',').map(option => option.trim()).filter(Boolean);
  if (options.length < 2 || options.length > 20) return { error: 'Provide between 2 and 20 non-empty options, separated by commas.' };
  return { value: options[randomInt(options.length)] };
}

export async function handleInteraction(interaction, logger = console, taskStore, fetchImpl = fetch, ollamaClient = createOllamaClient()) {
  if (!interaction.isChatInputCommand()) return;
  const supported = ['ping', 'hello', 'help', 'roll', 'choose', 'coinflip', 'github', 'ai', 'system', 'task'].includes(interaction.commandName);
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
    } else if (interaction.commandName === 'github') {
      if (interaction.options.getSubcommand() !== 'repo') return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await lookupPublicRepository(interaction.options.getString('repository', true), fetchImpl);
      await interaction.editReply({ content: result.content, allowedMentions: { parse: [] } });
      return;
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
