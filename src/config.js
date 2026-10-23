const DEFAULT_APPLICATION_ID = '1562965805413568532';

export function readConfig(env = process.env, { requireToken = true } = {}) {
  const token = env.DISCORD_BOT_TOKEN?.trim() ?? '';
  const applicationId = env.DISCORD_APPLICATION_ID?.trim() || DEFAULT_APPLICATION_ID;
  if (requireToken && !token) throw new Error('DISCORD_BOT_TOKEN is required.');
  if (!/^[1-9]\d{16,19}$/.test(applicationId)) {
    throw new Error('DISCORD_APPLICATION_ID must be a numeric Discord snowflake.');
  }
  return { token, applicationId };
}
