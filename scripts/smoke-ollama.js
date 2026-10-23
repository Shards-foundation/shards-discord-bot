import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOllamaClient } from '../src/ollama.js';

export async function runOllamaSmokeTest(client = createOllamaClient()) {
  const models = await client.listModels();
  const installed = models.some(item => item.name === client.model
    || (!client.model.includes(':') && item.name.split(':')[0] === client.model));
  if (!installed) throw new Error('Configured Ollama model is not installed. Pull ' + client.model + ' on the Ollama host.');
  const answer = await client.chat('For a connectivity check, respond with the exact text SHARDS_OLLAMA_OK and nothing else.');
  if (typeof answer?.content !== 'string' || !answer.content.trim()) throw new Error('Ollama inference returned no text.');
  return { model: client.model, installed: true, inference: true, responseCharacters: answer.content.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runOllamaSmokeTest();
    process.stdout.write('Ollama API: reachable\nConfigured model: ' + result.model + '\nModel installed: yes\nLive inference: passed\nResponse characters: ' + result.responseCharacters + '\n');
  } catch (error) {
    process.stderr.write('Ollama smoke test failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\n');
    process.exitCode = 1;
  }
}
