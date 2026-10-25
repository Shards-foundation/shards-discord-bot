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
        name: 'research',
        description: 'Use Qwen with bounded read-only public GitHub tools.',
        options: [{
          type: ApplicationCommandOptionType.String,
          name: 'prompt',
          description: 'What should Shards AI research on public GitHub?',
          required: true,
          min_length: 2,
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
        description: 'Queue a task for the local Qwen worker to process.',
        options: [{
          type: ApplicationCommandOptionType.String,
          name: 'request',
          description: 'Task request processed by the local Qwen worker.',
          required: true,
          min_length: 1,
          max_length: 2_000,
        }],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'research',
        description: 'Queue public GitHub research using Qwen read-only tools.',
        options: [{ type: ApplicationCommandOptionType.String, name: 'request', description: 'Research question about public GitHub repositories.', required: true, min_length: 2, max_length: 2000 }],
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
        name: 'retry',
        description: 'Requeue a failed task within its attempt limit.',
        options: [{ type: ApplicationCommandOptionType.String, name: 'task_id', description: 'ID returned by /task submit.', required: true }],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'events',
        description: 'View the audit history for your task.',
        options: [{ type: ApplicationCommandOptionType.String, name: 'task_id', description: 'ID returned by /task submit.', required: true }],
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
  {
    name: 'usage',
    description: 'Review your local-model usage and execution limits.',
    type: ApplicationCommandType.ChatInput,
    options: [{ type: ApplicationCommandOptionType.Subcommand, name: 'summary', description: 'Show token counts and configured budgets.' }],
  },
  {
    name: 'audit',
    description: 'Inspect your own task execution history.',
    type: ApplicationCommandType.ChatInput,
    options: [{
      type: ApplicationCommandOptionType.Subcommand,
      name: 'task',
      description: 'View lifecycle events for one of your tasks.',
      options: [{ type: ApplicationCommandOptionType.String, name: 'task_id', description: 'ID returned by /task submit.', required: true }],
    }],
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
    'Task executor: local Qwen worker (when Ollama is available)',
    `Process uptime: ${uptime}`,
    `Runtime: Node.js ${process.versions.node}`,
  ].join('\n');
}

const DISCORD_SAFE_CONTENT_LIMIT = 1_900;
const DISCORD_TRUNCATION_NOTICE = '\n\n[Output truncated to fit Discord. Request a shorter result for the complete answer.]';

function boundDiscordContent(content) {
  const text = String(content ?? '');
  if (text.length <= DISCORD_SAFE_CONTENT_LIMIT) return text;
  let prefixLength = DISCORD_SAFE_CONTENT_LIMIT - DISCORD_TRUNCATION_NOTICE.length;
  const finalCodeUnit = text.charCodeAt(prefixLength - 1);
  if (finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF) prefixLength -= 1;
  return text.slice(0, prefixLength) + DISCORD_TRUNCATION_NOTICE;
}

function activeTaskLimitMessage(error) {
  const limit = Number.isInteger(error?.limit) ? error.limit : 'configured';
  return `You have reached the active task limit (${limit}) for this server. Wait for a running task to finish or cancel a queued task before adding more.`;
}

async function recordAIUsage(usageStore, interaction, answer, source, logger) {
  if (!usageStore || typeof usageStore.record !== 'function') return;
  try {
    await usageStore.record({
      actorId: interaction.user.id,
      guildId: interaction.guildId ?? null,
      source,
      model: answer.model ?? 'unknown',
      promptTokens: answer.usage?.promptTokens ?? null,
      completionTokens: answer.usage?.completionTokens ?? null,
      durationNs: answer.usage?.durationNs ?? answer.totalDurationNs ?? null,
    });
  } catch {
    logger.error('AI usage metrics could not be persisted.');
  }
}

async function handleAICommand(interaction, ollamaClient, usageStore, logger, aiLimiter) {
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let permit;
  if (subcommand === 'ask' || subcommand === 'research') {
    if (!aiLimiter || typeof aiLimiter.tryAcquire !== 'function') throw new Error('AI request limiter is unavailable.');
    const key = `${interaction.guildId ?? 'dm'}:${interaction.user.id}`;
    permit = aiLimiter.tryAcquire(key, {
      requesterKey: interaction.user.id,
      scopeKey: interaction.guildId ?? `dm:${interaction.user.id}`,
    });
    if (!permit.allowed) {
      const requestScope = interaction.guildId ? 'in this server' : 'in this DM';
      const content = permit.reason === 'rate_limit'
        ? `AI request limit reached. You can make ${aiLimiter.limits.requestsPerMinute} generated requests per minute ${requestScope}. Try again in ${Math.max(1, Math.ceil(permit.retryAfterMs / 1_000))} seconds.`
        : 'Shards AI is at its current processing capacity. Try again shortly.';
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }
  }
  try {
    let content;
    if (subcommand === 'ask' || subcommand === 'research') {
      const prompt = interaction.options.getString('prompt', true);
      const answer = subcommand === 'research' ? await ollamaClient.research(prompt) : await ollamaClient.chat(prompt);
      await recordAIUsage(usageStore, interaction, answer, subcommand === 'research' ? 'ai_research' : 'ai_chat', logger);
      const seconds = answer.totalDurationNs == null ? 'research tools: ' + (answer.toolCallsUsed ?? 0) : (answer.totalDurationNs / 1e9).toFixed(1) + 's';
      content = '**Shards AI · ' + answer.model + ' · ' + seconds + '**\n' + answer.content;
    } else {
      const models = await ollamaClient.listModels();
      const installed = models.some(item => item.name === ollamaClient.model
        || (!ollamaClient.model.includes(':') && item.name.split(':')[0] === ollamaClient.model));
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
    await interaction.editReply({ content: boundDiscordContent(content), allowedMentions: { parse: [] } });
  } finally {
    permit?.release();
  }
}

async function handleTaskCommand(interaction, taskStore) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Task requests are available only inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  let content;
  if (subcommand === 'submit' || subcommand === 'research') {
    try {
      const task = await taskStore.submit({
        requesterId: interaction.user.id,
        guildId: interaction.guildId,
        request: interaction.options.getString('request', true),
        idempotencyKey: interaction.id,
        mode: subcommand === 'research' ? 'github_research' : 'chat',
      });
      content = `Task ${task.id} was saved to the durable queue (mode: ${task.mode ?? 'chat'}, status: ${task.state}). The local Qwen worker will process it when the required service is available. Check /task status for the result.`;
    } catch (error) {
      if (error?.code !== 'TASK_ACTIVE_LIMIT') throw error;
      content = activeTaskLimitMessage(error);
    }
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
    } else if (subcommand === 'retry') {
      try {
        const task = await taskStore.retry(taskId, interaction.user.id, { guildId: interaction.guildId });
        content = task ? 'Task ' + task.id + ' requeued (status: ' + task.state + ', attempts used: ' + task.attempts + ').' : 'Task not found or you are not authorised to retry it.';
      } catch (error) {
        if (error?.code !== 'TASK_ACTIVE_LIMIT') throw error;
        content = activeTaskLimitMessage(error);
      }
    } else if (subcommand === 'events') {
      const events = await taskStore.events(taskId, interaction.user.id, { guildId: interaction.guildId });
      content = events ? (events.length ? '**Task audit history (' + events.length + ')**\n' + events.slice(-10).map(event => '• ' + event.at + ' — ' + event.action).join('\n') : 'No audit events recorded.') : 'Task not found or you are not authorised to view its audit history.';
    } else {
      content = 'Unsupported task operation.';
    }
  }
  await interaction.editReply({ content: boundDiscordContent(content), allowedMentions: { parse: [] } });
}

async function handleUsageCommand(interaction, usageStore, aiLimiter, taskStore) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!usageStore) throw new Error('Usage store is unavailable.');
  const usage = await usageStore.summary(interaction.user.id, interaction.guildId ?? null);
  const modelEntries = Object.entries(usage.models);
  const models = modelEntries.length
    ? modelEntries.slice(0, 8).map(([model, requests]) => `${model}: ${requests}`).join(', ')
      + (modelEntries.length > 8 ? `, +${modelEntries.length - 8} more` : '')
    : 'none recorded';
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 120_000);
  const aiLimits = aiLimiter?.limits;
  const activeTaskLimit = Number.isInteger(taskStore?.maxActiveTasksPerRequester)
    ? taskStore.maxActiveTasksPerRequester : 'not configured';
  const content = [
    `Successful model requests recorded: ${usage.requests}`,
    `Requests with token metrics: ${usage.measuredRequests}/${usage.requests}`,
    `Prompt tokens: ${usage.promptTokens}`,
    `Generated tokens: ${usage.completionTokens}`,
    `Model processing time: ${(usage.durationNs / 1e9).toFixed(1)} s`,
    `Models: ${models}`,
    `AI generation limits: ${aiLimits ? `${aiLimits.requestsPerMinute} requests/minute per requester/server-or-DM; ${aiLimits.maxConcurrent} concurrent direct calls per process; at most ${aiLimits.maxConcurrentPerRequester} per requester and ${aiLimits.maxConcurrentPerScope} per server/DM scope` : 'not configured for this runtime'}.`,
    `Active task limit: ${activeTaskLimit} queued/running tasks per requester/server.`,
    ...(aiLimits ? ['AI limit state is process-local; it resets on restart and is not shared across replicas.'] : []),
    'Execution bounds: 3,000-character AI prompt; 512 generated tokens per chat; research up to 6 rounds and 5 public-GitHub tool calls (700 tokens per round).',
    `Task worker: one task at a time; Ollama timeout ${timeoutMs} ms. Direct model calls are subject to the generation limits above.`,
    'Token and duration values are reported by Ollama; failed/partial calls may not be included. Local inference has no model API bill; host and electricity costs still apply.',
    ...(usage.historyTruncated ? ['Older usage records were removed after the 20,000-record storage limit.'] : []),
  ].join('\n');
  await interaction.editReply({ content: boundDiscordContent(content), allowedMentions: { parse: [] } });
}

async function handleAuditCommand(interaction, taskStore) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Audit views are available only inside a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!taskStore) throw new Error('Task store is unavailable.');
  const taskId = interaction.options.getString('task_id', true);
  const events = await taskStore.events(taskId, interaction.user.id, { guildId: interaction.guildId });
  const content = events
    ? (events.length
      ? `**Task lifecycle audit (${events.length} events)**\n${events.slice(-15).map(event => `• ${event.at} — ${event.action}`).join('\n')}\nPolicy decisions are not yet recorded by this version.`
      : 'No lifecycle events are recorded for this task.')
    : 'Task not found or you are not authorised to view its audit history.';
  await interaction.editReply({ content: boundDiscordContent(content), allowedMentions: { parse: [] } });
}

const HELP_TEXT = [
  '**Shards bot commands**',
  '`/ping` — gateway latency check',
  '`/hello` — greeting',
  '`/system status` — runtime and connection status',
  '`/task submit` — queue a Qwen text task; `/task research` — queue public GitHub research using bounded read-only tools; `/task status`, `/task cancel`, `/task retry`, `/task events` — lifecycle, retries, and audit history',
  '`/roll [sides]` — roll a die (2–1000 sides; defaults to 6)',
  '`/choose options` — randomly select from 2–20 comma-separated options',
  '`/coinflip` — heads or tails',
  '`/github repo owner/name` — public GitHub repository metadata',
  '`/ai ask prompt` — send a prompt to the configured Qwen model through Ollama',
  '`/ai research prompt` — Qwen-assisted, read-only public GitHub research with a bounded tool loop',
  '`/ai status` and `/ai models` — check Ollama and installed models',
  '`/usage summary` — review your token consumption, request limits, and task queue limits',
  '`/audit task task_id` — inspect lifecycle events for your own task; policy decisions are not yet recorded',
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

export async function handleInteraction(interaction, logger = console, taskStore, fetchImpl = fetch, ollamaClient = createOllamaClient(), usageStore, aiLimiter) {
  if (!interaction.isChatInputCommand()) return;
  const supported = ['ping', 'hello', 'help', 'roll', 'choose', 'coinflip', 'github', 'ai', 'system', 'task', 'usage', 'audit'].includes(interaction.commandName);
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
      await interaction.editReply({ content: boundDiscordContent(result.content), allowedMentions: { parse: [] } });
      return;
    } else if (interaction.commandName === 'task') {
      if (!taskStore) throw new Error('Task store is unavailable.');
      await handleTaskCommand(interaction, taskStore);
      return;
    } else if (interaction.commandName === 'ai') {
      await handleAICommand(interaction, ollamaClient, usageStore, logger, aiLimiter);
      return;
    } else if (interaction.commandName === 'usage') {
      await handleUsageCommand(interaction, usageStore, aiLimiter, taskStore);
      return;
    } else if (interaction.commandName === 'audit') {
      await handleAuditCommand(interaction, taskStore);
      return;
    } else if (interaction.options.getSubcommand() === 'status') {
      content = formatStatus(interaction.client);
    } else {
      return;
    }
    await interaction.reply({ content: boundDiscordContent(content), allowedMentions: { parse: [] } });
  } catch {
    // Never log raw Discord errors: request metadata may contain credentials.
    logger.error('Slash command failed.');
    const fallback = {
      content: 'Something went wrong. Please try again later.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };
    try {
      if (interaction.deferred && typeof interaction.editReply === 'function') await interaction.editReply(fallback);
      else if (interaction.replied) await interaction.followUp(fallback);
      else await interaction.reply(fallback);
    } catch {
      logger.error('Unable to send the private error response.');
    }
  }
}
