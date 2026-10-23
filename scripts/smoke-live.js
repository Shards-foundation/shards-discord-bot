import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfig } from '../src/config.js';
import { createOllamaClient } from '../src/ollama.js';
import { runOllamaSmokeTest } from './smoke-ollama.js';

export async function runLiveRuntimePreflight({ env = process.env, fetchImpl = fetch, ollamaClient } = {}) {
  const config = readConfig(env);
  let response;
  try {
    response = await fetchImpl('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: { Authorization: 'Bot ' + config.token, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Discord API connectivity check failed or timed out.');
  }
  if (!response.ok) throw new Error('Discord bot token check failed (HTTP ' + response.status + ').');
  let bot;
  try { bot = await response.json(); } catch { throw new Error('Discord returned an invalid bot identity response.'); }
  if (typeof bot?.id !== 'string' || typeof bot?.username !== 'string') throw new Error('Discord returned an unexpected bot identity response.');
  if (bot.id !== config.applicationId) throw new Error('DISCORD_APPLICATION_ID does not match the bot identity returned by Discord.');
  const ollama = await runOllamaSmokeTest(ollamaClient ?? createOllamaClient());
  return { discord: true, botUsername: bot.username, applicationId: config.applicationId, ollama };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runLiveRuntimePreflight();
    process.stdout.write('Discord API token: valid\nBot identity: ' + result.botUsername + '\nApplication ID: ' + result.applicationId + '\nOllama model: ' + result.ollama.model + '\nLive inference: passed\n');
  } catch (error) {
    process.stderr.write('Live runtime preflight failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\n');
    process.exitCode = 1;
  }
}
