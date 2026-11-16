import { Routes } from 'discord.js'

export const ACTIVITY_ENTRY_POINT = Object.freeze({
  name: 'launch',
  description: 'Launch Shards Mission Control',
  type: 4, // PRIMARY_ENTRY_POINT
  handler: 2, // DISCORD_LAUNCH_ACTIVITY: no bot Gateway or HTTP callback needed
  integration_types: [0], // Guild installations
  contexts: [0] // Guild context
})

const APPLICATION_ID = /^[1-9]\d{16,19}$/

export function parseEntryPointArgs (args = []) {
  if (args.length === 0) return { mode: 'preview' }
  if (args.length === 1 && args[0] === '--check') return { mode: 'check' }
  if (args.length === 2 && args[0] === '--apply' && args[1] === '--confirm-add-only') {
    return { mode: 'apply' }
  }
  throw new Error('Usage: [no flags] | --check | --apply --confirm-add-only')
}

export async function ensureActivityEntryPoint (rest, appId, { mode = 'check' } = {}) {
  if (!APPLICATION_ID.test(appId)) throw new Error('Invalid application ID.')
  if (mode !== 'check' && mode !== 'apply') throw new Error('Unknown operation.')
  const route = Routes.applicationCommands(appId)

  // Discord's GET is read only. It does not access or change server command scopes.
  const current = await rest.get(route)
  if (!Array.isArray(current)) throw new Error('Invalid global command listing.')
  const entries = current.filter(command => command?.type === 4)

  if (entries.length > 1) throw new Error('Multiple Entry Points found; manual review is required.')
  if (entries.length === 1) {
    const entry = entries[0]
    return {
      state: entry.handler === 2 ? 'present' : 'needs_review',
      changed: false,
      name: typeof entry.name === 'string' ? entry.name : 'unknown',
      handler: entry.handler ?? null,
      preservedCommands: current.length
    }
  }

  // POST is an upsert in Discord. Reject *any* existing use of our chosen
  // name, even another command type, to avoid replacing something by mistake.
  if (current.some(command => command?.name?.toLowerCase() === ACTIVITY_ENTRY_POINT.name)) {
    return { state: 'name_conflict', changed: false, preservedCommands: current.length }
  }

  if (mode === 'check') {
    return { state: 'missing', changed: false, preservedCommands: current.length }
  }

  // Re-read immediately before a write to catch concurrent command edits.
  const confirm = await rest.get(route)
  if (!Array.isArray(confirm) ||
    confirm.length !== current.length ||
    confirm.some(command => command?.type === 4 ||
      command?.name?.toLowerCase() === ACTIVITY_ENTRY_POINT.name)) {
    throw new Error('Remote command listing changed; no write attempted.')
  }
  const original = current.map(x => x?.id).sort()
  const latest = confirm.map(x => x?.id).sort()
  if (JSON.stringify(original) !== JSON.stringify(latest)) {
    throw new Error('Remote command IDs changed; no write attempted.')
  }

  // One POST; never PUT, PATCH or DELETE, never overwrite existing registration.
  const created = await rest.post(route, { body: ACTIVITY_ENTRY_POINT })
  if (created?.type !== 4 || created?.handler !== 2 || created?.name !== ACTIVITY_ENTRY_POINT.name) {
    throw new Error('Discord returned an unexpected result; check command listing.')
  }
  return { state: 'created', changed: true, name: created.name, preservedCommands: current.length }
}
