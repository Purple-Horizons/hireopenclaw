const { execFileSync } = require('child_process');

// Named constants (TASK-306)
const DEFAULT_DOCKER_TIMEOUT_MS = 15000;
const DEFAULT_DOCKER_RETRIES = 3;

async function dockerExec(args, options = {}) {
  const maxRetries = options.retries || DEFAULT_DOCKER_RETRIES;
  const timeout = options.timeout || DEFAULT_DOCKER_TIMEOUT_MS;
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return execFileSync('docker', args, {
        encoding: 'utf8',
        timeout,
        ...options
      });
    } catch (err) {
      lastError = err;
      if (i < maxRetries - 1) {
        console.warn(`[Docker] Retry ${i + 1}/${maxRetries} for: docker ${args.join(' ')}`);
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastError;
}

module.exports = { dockerExec };
