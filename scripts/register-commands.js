import { REST } from 'discord.js';
import { commands } from '../src/commands.js';
import { readConfig } from '../src/config.js';
import { registrationPlan, registerCommands } from '../src/registration.js';

let writing = false;
try {
  const plan = registrationPlan(process.argv.slice(2));
  const config = readConfig(process.env, { requireToken: plan.apply });
  if (!plan.apply) {
    console.log(JSON.stringify({ ...plan, applicationId: config.applicationId, commands }, null, 2));
  } else {
    writing = true;
    console.warn(`Replacing ${plan.scope} commands for application ${config.applicationId}.`);
    const rest = new REST({ version: '10' }).setToken(config.token);
    await registerCommands(rest, config.applicationId, plan);
    console.log('Slash commands registered successfully.');
  }
} catch (error) {
  // Local argument/config errors are safe; never print API errors with request metadata.
  console.error(writing ? 'Registration failed. Check permissions, credentials, and network access before retrying.' : error.message);
  process.exitCode = 1;
}
