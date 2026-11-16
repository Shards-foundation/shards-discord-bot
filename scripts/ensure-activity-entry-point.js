import { REST } from 'discord.js'
import { readConfig } from '../src/config.js'
import {
  ACTIVITY_ENTRY_POINT,
  ensureActivityEntryPoint,
  parseEntryPointArgs
} from '../src/activity-entry-point.js'

let remoteOperation = false
try {
  const plan = parseEntryPointArgs(process.argv.slice(2))
  const config = readConfig(process.env, { requireToken: plan.mode !== 'preview' })

  if (plan.mode === 'preview') {
    console.log(JSON.stringify({
      mode: plan.mode,
      applicationId: config.applicationId,
      action: 'Offline preview only; no Discord connection or command changes',
      command: ACTIVITY_ENTRY_POINT,
      safety: 'Single Entry Point; no PUT, PATCH, DELETE or bulk replacement'
    }, null, 2))
  } else {
    remoteOperation = true
    const rest = new REST({ version: '10' }).setToken(config.token)
    const result = await ensureActivityEntryPoint(rest, config.applicationId, { mode: plan.mode })
    console.log(JSON.stringify(result))
    if (result.state === 'needs_review' || result.state === 'name_conflict') {
      process.exitCode = 2
    }
  }
} catch (error) {
  // Never print remote exception details: they may include secret request metadata.
  console.error(remoteOperation
    ? 'Discord inspection or Entry Point creation failed. No bulk command update was attempted.'
    : error.message)
  process.exitCode = 1
}
