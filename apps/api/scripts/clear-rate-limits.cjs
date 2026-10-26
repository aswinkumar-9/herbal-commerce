// Clears every rate-limit counter in the local Valkey, so tests can run again
// at once. Development only: it refuses unless NODE_ENV is "development".
const path = require('node:path');
const Redis = require('ioredis');

async function main() {
  process.loadEnvFile(path.join(__dirname, '..', '..', '..', '.env'));
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('refusing to run because NODE_ENV is not "development"');
  }
  // Fail at once instead of retrying when Valkey is not running.
  const valkey = new Redis(process.env.VALKEY_URL, {
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  valkey.on('error', () => undefined);
  try {
    let cleared = 0;
    for await (const keys of valkey.scanStream({ match: 'rl:*', count: 100 })) {
      if (keys.length > 0) {
        cleared += await valkey.unlink(...keys);
      }
    }
    console.log(`Cleared ${cleared} rate-limit counter(s).`);
  } finally {
    valkey.disconnect();
  }
}

main().catch((error) => {
  console.error(`Could not clear rate limits: ${error.message}`);
  console.error('Is Valkey running (docker compose up -d)?');
  process.exitCode = 1;
});
