export function createShutdownHandler(client, { logger = console, onComplete = () => {} } = {}) {
  let shutdownPromise;
  return signal => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      logger.info(`Received ${signal}; shutting down Discord client.`);
      try {
        await client.destroy();
        onComplete(0);
      } catch {
        logger.error('Discord client shutdown failed.');
        onComplete(1);
      }
    })();
    return shutdownPromise;
  };
}
