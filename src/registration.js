import { Routes } from 'discord.js';
import { commands } from './commands.js';

export function registrationPlan(args) {
  const seen = new Set();
  let guildId = null;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--apply', '--global', '--confirm-global', '--guild'].includes(flag)) {
      throw new Error('Unknown registration argument.');
    }
    if (seen.has(flag)) throw new Error('Repeated registration argument.');
    seen.add(flag);
    if (flag === '--guild') {
      guildId = args[++index];
      if (!/^[1-9]\d{16,19}$/.test(guildId ?? '')) throw new Error('--guild needs a numeric Discord guild ID.');
    }
  }
  if (seen.has('--guild') && seen.has('--global')) throw new Error('Choose only one scope.');
  if (seen.has('--confirm-global') && !seen.has('--global')) throw new Error('--confirm-global requires --global.');
  const apply = seen.has('--apply');
  if (apply && !seen.has('--guild') && !seen.has('--global')) throw new Error('--apply requires an explicit scope.');
  if (apply && seen.has('--global') && !seen.has('--confirm-global')) {
    throw new Error('Global writes require --confirm-global; this replaces all global commands.');
  }
  return { apply, scope: guildId ? 'guild' : 'global', guildId };
}

export async function registerCommands(rest, applicationId, plan) {
  if (!plan.apply) return commands;
  const route = plan.scope === 'guild'
    ? Routes.applicationGuildCommands(applicationId, plan.guildId)
    : Routes.applicationCommands(applicationId);
  return rest.put(route, { body: commands });
}
